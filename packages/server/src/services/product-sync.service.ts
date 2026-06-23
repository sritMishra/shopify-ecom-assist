// product-sync.service.ts
//
// Orchestrates the full product sync pipeline:
//   Shopify (all products) → build text documents → OpenAI embeddings → PostgreSQL
//
// This runs once manually to do the initial sync of all products.
// Later, webhooks (Step 7) will call syncSingleProduct() for individual updates.

import { prisma } from '../lib/db';
import logger from '../utils/logger';
import { buildEmbeddingDocument, generateEmbeddings } from './embedding.service';
import { shopifyGraphQL } from './shopify/shopify.client';

// ---------------------------------------------------------------------------
// Shopify GraphQL query — fetch all products with cursor-based pagination.
//
// Why cursor-based pagination?
// Shopify won't let you fetch all 10,000 products in one call. You get pages
// of up to 250 at a time. Each page returns an `endCursor` — a bookmark that
// tells Shopify "start the next page from here". We loop until hasNextPage
// is false, meaning we've fetched everything.
// ---------------------------------------------------------------------------
const FETCH_ALL_PRODUCTS_QUERY = `
  query FetchAllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          productType
          tags
          handle
          priceRangeV2 {
            minVariantPrice { amount }
            maxVariantPrice { amount }
          }
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

// TypeScript types for the Shopify response
interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
  handle: string;
  priceRangeV2: {
    minVariantPrice: { amount: string };
    maxVariantPrice: { amount: string };
  };
  featuredImage: { url: string } | null;
}

interface ShopifyProductsResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: ShopifyProductNode }[];
  };
}

// ---------------------------------------------------------------------------
// toVectorSql
//
// Converts a JavaScript number array to the string format pgvector expects.
// e.g. [0.21, -0.43, 0.87] → '[0.21,-0.43,0.87]'
// This is the same thing the pgvector npm package's toSql() does internally.
// ---------------------------------------------------------------------------
function toVectorSql(vector: number[]): string {
  return '[' + vector.join(',') + ']';
}

// ---------------------------------------------------------------------------
// upsertProductEmbedding
//
// Writes one product + its embedding vector to PostgreSQL.
// "Upsert" = INSERT if new, UPDATE if the shopify_id already exists.
//
// Why upsert and not just insert?
// The sync can be run multiple times safely. If you run it twice, you get
// updated embeddings rather than duplicate rows or errors.
//
// Why $executeRaw (raw SQL) instead of prisma.productEmbedding.create()?
// Prisma doesn't support the `vector` type natively — it's marked as
// `Unsupported` in the schema. So we use raw SQL for this one operation.
// pgvector.toSql() converts [0.21, -0.43, ...] → '[0.21,-0.43,...]' (the
// string format PostgreSQL's vector type expects).
// ---------------------------------------------------------------------------
async function upsertProductEmbedding(
  product: ShopifyProductNode,
  embedding: number[]
): Promise<void> {
  // Convert the JS number array to the SQL string format pgvector expects
  const vectorStr = toVectorSql(embedding);

  const priceMin = parseFloat(product.priceRangeV2.minVariantPrice.amount);
  const priceMax = parseFloat(product.priceRangeV2.maxVariantPrice.amount);

  await prisma.$executeRaw`
    INSERT INTO product_embeddings
      (shopify_id, title, product_type, tags, price_min, price_max, handle, image_url, embedding, synced_at)
    VALUES (
      ${product.id},
      ${product.title},
      ${product.productType || null},
      ${product.tags},
      ${priceMin},
      ${priceMax},
      ${product.handle || null},
      ${product.featuredImage?.url || null},
      ${vectorStr}::vector,
      NOW()
    )
    ON CONFLICT (shopify_id) DO UPDATE SET
      title        = EXCLUDED.title,
      product_type = EXCLUDED.product_type,
      tags         = EXCLUDED.tags,
      price_min    = EXCLUDED.price_min,
      price_max    = EXCLUDED.price_max,
      handle       = EXCLUDED.handle,
      image_url    = EXCLUDED.image_url,
      embedding    = EXCLUDED.embedding,
      synced_at    = NOW()
  `;
}

// ---------------------------------------------------------------------------
// syncAllProducts (the main export)
//
// Fetches ALL products from Shopify page by page, embeds each page as a batch,
// then upserts them into PostgreSQL.
//
// Page size is 50 — a balance between:
//   - Too small (10): too many Shopify API calls
//   - Too large (250): too much memory held at once, slower recovery if it fails
//
// Returns a summary: { synced: N, failed: M }
// ---------------------------------------------------------------------------
export async function syncAllProducts(): Promise<{ synced: number; failed: number }> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let synced = 0;
  let failed = 0;
  let page = 1;

  logger.info('Product sync started');

  while (hasNextPage) {
    logger.info({ page }, 'Fetching product page from Shopify');

    // Step 1: Fetch one page of products from Shopify
    const data: ShopifyProductsResponse = await shopifyGraphQL<ShopifyProductsResponse>(
      FETCH_ALL_PRODUCTS_QUERY,
      { first: 50, after: cursor }
    );

    const products = data.products.edges.map((e: { node: ShopifyProductNode }) => e.node);

    if (products.length === 0) break;

    // Step 2: Build one text document per product in this page
    const documents = products.map((p: ShopifyProductNode) =>
      buildEmbeddingDocument({
        title: p.title,
        productType: p.productType,
        tags: p.tags,
        description: p.description,
      })
    );

    // Step 3: Send all documents in this page to OpenAI in a single batch call
    // This returns one vector (1536 numbers) per document, in the same order
    const embeddings = await generateEmbeddings(documents);

    // Step 4: Upsert each product with its corresponding embedding into PostgreSQL
    for (let i = 0; i < products.length; i++) {
      try {
        await upsertProductEmbedding(products[i], embeddings[i]);
        synced++;
      } catch (err) {
        logger.error({ err, shopifyId: products[i].id }, 'Failed to upsert product embedding');
        failed++;
      }
    }

    logger.info({ page, synced, failed }, 'Page synced');

    // Move to the next page
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
    page++;
  }

  logger.info({ synced, failed }, 'Product sync complete');
  return { synced, failed };
}
