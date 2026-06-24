// vector-search.service.ts
//
// Performs semantic product search using pgvector cosine similarity.
//
// Flow:
//   1. Embed the user's query text → 1536 numbers (same model used at sync time)
//   2. Apply any hard filters as SQL WHERE clauses (productType, price)
//   3. Rank the filtered rows by cosine distance to the query vector
//   4. Return top N products mapped to the shared Product type
//
// Why this beats keyword search:
//   "something gentle on my stomach for energy" finds "pre-workout supplement"
//   even though none of those words appear in the product title or tags.
//   The OpenAI embedding model learned those concepts are semantically related.

import { prisma } from '../lib/db';
import type { Product, SearchProductsParams } from '../types';
import { generateEmbeddings } from './embedding.service';

// Shape of a raw row returned from the product_embeddings table.
// We don't SELECT the embedding column — it's large and not needed after search.
interface ProductRow {
  shopify_id: string;
  title: string;
  product_type: string | null;
  tags: string[];
  price_min: number | null;
  price_max: number | null;
  handle: string | null;
  image_url: string | null;
}

// ---------------------------------------------------------------------------
// rowToProduct
//
// Maps a raw DB row to the shared Product type the chat tool expects.
// Some fields (description, currencyCode, altText) are not stored in the
// vector DB — they are defaulted here. If they become important later,
// add them as columns to the schema and re-sync.
// ---------------------------------------------------------------------------
function rowToProduct(row: ProductRow): Product {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? '';

  return {
    id: row.shopify_id,
    title: row.title,
    // Description is not stored in the vector DB (only used for embedding).
    // Default to empty string — the chat uses title + tags for display anyway.
    description: '',
    productType: row.product_type ?? '',
    tags: row.tags ?? [],
    handle: row.handle ?? '',
    price: {
      min: {
        amount: row.price_min ?? 0,
        // Currency code is not stored in the vector DB.
        // The chat displays the amount — currency is cosmetic for now.
        currencyCode: '',
      },
      max: {
        amount: row.price_max ?? 0,
        currencyCode: '',
      },
    },
    image: row.image_url ? { url: row.image_url, altText: null } : null,
    url: `https://${storeDomain}/products/${row.handle}`,
  };
}

// ---------------------------------------------------------------------------
// searchByVector (main export)
//
// Takes the same SearchProductsParams shape as the existing Shopify keyword
// search — so replacing the tool in Step 6 requires minimal changes.
//
// Hard filters use a null-safe WHERE pattern — each condition becomes a no-op
// when its parameter is null (filter not provided). This avoids dynamic SQL
// building entirely while keeping all values safely parameterised.
//
// Pattern: (${value}::type IS NULL OR column operator ${value}::type)
//   → when value is null:  (NULL IS NULL OR ...)  → true  (condition skipped)
//   → when value is set:   (value IS NULL OR ...) → evaluates the real check
// ---------------------------------------------------------------------------
export async function searchByVector(params: SearchProductsParams): Promise<Product[]> {
  const { query, minPrice, maxPrice, productType, limit = 5 } = params;

  // Null-safe filter values — null means "no filter applied"
  const filterType = productType ?? null;
  const filterMin = minPrice ?? null;
  const filterMax = maxPrice ?? null;

  if (query && query.trim().length > 0) {
    // --- Embed the query -------------------------------------------------------
    // Must use the same model as sync time — different models produce
    // incompatible vector spaces and similarity scores would be meaningless.
    console.log('query=>', query);
    const [queryEmbedding] = await generateEmbeddings([query]);

    // Serialise the JS number array to pgvector's SQL string format
    // e.g. [0.21, -0.43] → '[0.21,-0.43]'
    const vectorStr = '[' + queryEmbedding.join(',') + ']';

    // --- Cosine similarity search with null-safe hard filters -----------------
    // The <=> operator is pgvector's cosine distance — ORDER BY ASC = most similar first.
    // Each WHERE condition is a no-op when its filter value is null.
    const rows = await prisma.$queryRaw<ProductRow[]>`
      SELECT shopify_id, title, product_type, tags, price_min, price_max, handle, image_url,
             embedding <=> ${vectorStr}::vector AS cosine_distance
      FROM product_embeddings
      WHERE (${filterType}::text IS NULL OR product_type = ${filterType}::text)
        AND (${filterMin}::float8 IS NULL OR price_min >= ${filterMin}::float8)
        AND (${filterMax}::float8 IS NULL OR price_min <= ${filterMax}::float8)
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    // Log scores so you can see how similar each result is to the query
    // cosine_distance: 0.0 = identical, 1.0 = unrelated, 2.0 = opposite
    console.log('🎯 Vector search scores:');
    (rows as Array<ProductRow & { cosine_distance: number }>).forEach((r) => {
      console.log(`  [${r.cosine_distance?.toFixed(4)}] ${r.title}`);
    });

    return rows.map(rowToProduct);
  }

  // --- Fallback: no query text — apply hard filters only, order by price -----
  // Handles "show me all supplements under 500" where there is no semantic query.
  const rows = await prisma.$queryRaw<ProductRow[]>`
    SELECT shopify_id, title, product_type, tags, price_min, price_max, handle, image_url
    FROM product_embeddings
    WHERE (${filterType}::text IS NULL OR product_type = ${filterType}::text)
      AND (${filterMin}::float8 IS NULL OR price_min >= ${filterMin}::float8)
      AND (${filterMax}::float8 IS NULL OR price_min <= ${filterMax}::float8)
    ORDER BY price_min ASC
    LIMIT ${limit}
  `;

  return rows.map(rowToProduct);
}
