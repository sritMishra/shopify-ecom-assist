# Phase 2 — Semantic Search with Vector Embeddings

---

## The Problem Phase 1 Cannot Solve

Phase 1 works as follows:

```
User message → OpenAI extracts keywords → Shopify keyword search → results
```

OpenAI acts as a smart translator between user intent and keywords. This works well for common category names but breaks in four specific ways — all tested and confirmed live.

---

### Failure 1 — Word not in product data

**User:** "I want something that does not upset my stomach but still gives me energy"
**OpenAI extracted:** `gentle pre-workout`
**Shopify returned:** nothing

Shopify matched the words `"gentle"` and `"pre-workout"` against product titles, tags, and descriptions. No product had the word `"gentle"` in any of those fields — even though a product may genuinely be easy on the stomach. The intent was understood. The data didn't have matching words.

---

### Failure 2 — Similarity search is impossible

**User:** "Show me something similar to the pre-workout you just showed me"
**OpenAI extracted:** `pre-workout`
**Result:** Same products returned again

There is no keyword that means "similar to X". OpenAI had no choice but to re-search the same category. The user expected discovery — they got repetition.

---

### Failure 3 — Metadata dependency makes products invisible

**User:** "Show me your t-shirts"
**Result:** No products found

The t-shirts existed in the store but had an empty `Product type` field in Shopify. The system prompt tells the AI what the store sells using the `productTypes` API — which only lists types explicitly set on products. With no `productType` set, the AI did not know t-shirts existed.

Phase 1 knowledge of the catalog is entirely dependent on products having clean, complete metadata.

---

### Failure 4 — Negation and ingredient filtering

**User:** "Show me a pre-workout without caffeine"
**OpenAI extracted:** `""` (empty query) with `product_type: "Supplements"`
**Result:** All supplements returned, including caffeinated ones

There is no keyword you can search *for* to express *"does not contain caffeine"*. OpenAI sent an empty query as a fallback, returning everything and hoping the AI could reason about caffeine from product descriptions — which it cannot without that data.

---

## How Phase 1 Still Works (And Why)

Phase 1 is not purely keyword search. OpenAI bridges user intent to keywords before Shopify ever sees the query:

- "I feel weak before gym" → `pre-workout` → found ✓
- "Something to build muscle" → `protein supplement` → found ✓

This works when the user's intent maps to a standard product category name that exists in product titles or tags. It fails when the user describes feelings, attributes, negations, or asks for similarity — none of which can be expressed as a keyword.

---

## The Phase 2 Solution — Vector Embeddings

### What an embedding is

The OpenAI Embeddings API converts any text into a list of 1536 numbers — a vector. This vector represents the *meaning* of the text in mathematical space. The critical property:

**Semantically similar text produces vectors that are numerically close.**

```
"pre-workout supplement"      → [0.21, -0.43, 0.87, ...]
"energy booster before gym"   → [0.19, -0.41, 0.85, ...]  ← very close
"cotton t-shirt"              → [0.72,  0.11, -0.34, ...] ← very far
```

This closeness was learned during OpenAI's training on billions of documents — not computed by your system. The synonym understanding is pre-built. You leverage it.

### How search works

At query time:

1. Embed the user's message using the same model
2. Compare that query vector against all stored product vectors
3. Return products whose vectors are closest (cosine similarity)

"Gentle on stomach energy supplement" as a query vector will land close to a product described as "easy to digest formula with sustained energy release" — even though no words overlap.

---

## What Data We Need Per Product

No manual work is required. The system auto-generates an embedding document from existing Shopify product data:

```typescript
function buildEmbeddingDocument(product: Product): string {
  const parts = [`Product: ${product.title}`];
  if (product.productType) parts.push(`Type: ${product.productType}`);
  if (product.tags.length)  parts.push(`Tags: ${product.tags.join(', ')}`);
  if (product.description)  parts.push(`Description: ${product.description}`);
  return parts.join('\n');
}
```

**Example output for a current product (no description):**
```
Product: Optimum Nutrition Gold Standard Whey
Type: Supplements
Tags: protein, post-workout, muscle-building
```

**Example output after descriptions are added:**
```
Product: Optimum Nutrition Gold Standard Whey
Type: Supplements
Tags: protein, post-workout, muscle-building
Description: Fast-absorbing whey protein with 24g protein per serving.
Easy to digest. No artificial fillers. Ideal for post-workout recovery.
```

Descriptions are not required to start Phase 2. Title + tags + productType gives a working embedding. Descriptions make it significantly richer — and can be added incrementally without code changes.

---

## The Architecture — Three Layers

Pure vector search is semantically flexible but can be unpredictable. A robust system layers vector search with hard constraints:

### Layer 1 — Hard Metadata Filters (fully predictable)

Structured columns stored in PostgreSQL alongside the vector — not embedded. Applied as strict WHERE clauses before vector search runs.

```
price_min, price_max, product_type, in_stock, tags[]
```

Example: "under ₹500" → `WHERE price_min <= 500` — this never uses the vector. It is an exact database filter.

### Layer 2 — Vector Similarity (semantic ranking)

After hard filters narrow the pool, rank remaining products by cosine similarity to the query embedding. This handles:
- "Gentle on stomach" — no matching keyword, but semantically close products surface
- "Similar to the pre-workout" — embed the source product, find nearest neighbors
- "Something for beginners" — no tag exists for this, but meaning maps correctly

### Layer 3 — Keyword Fallback (reliability net)

For exact product name queries ("show me Gold Standard Whey"), keyword search is more reliable than vector search. The system runs both and merges results — keyword wins on exact matches, vector wins on conceptual queries.

---

## The Sync Process

### Initial sync (runs once)

1. Fetch all products from Shopify Admin API in bulk
2. For each product: build the embedding document
3. Send to OpenAI Embeddings API (`text-embedding-3-small`)
4. Store vector + metadata in PostgreSQL/pgvector

### Ongoing sync (automated)

Shopify fires a webhook on every product create, update, or delete. The server catches it and re-embeds only that one product. All other vectors stay unchanged.

```
Shopify product updated
       ↓
Webhook received by server
       ↓
Rebuild embedding document for that product
       ↓
Re-embed via OpenAI API
       ↓
Update PostgreSQL row
```

---

## Database Schema (PostgreSQL + pgvector)

```sql
CREATE TABLE product_embeddings (
  id              SERIAL PRIMARY KEY,
  shopify_id      TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  product_type    TEXT,
  tags            TEXT[],
  price_min       DECIMAL,
  price_max       DECIMAL,
  handle          TEXT,
  image_url       TEXT,
  embedding       vector(1536),
  synced_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON product_embeddings
  USING ivfflat (embedding vector_cosine_ops);
```

---

## Cost

OpenAI's `text-embedding-3-small` model is extremely cheap.

| Scale | Tokens | Cost |
|---|---|---|
| 1,000 products | ~100k tokens | ~$0.002 |
| 10,000 products | ~1M tokens | ~$0.02 |
| 100,000 products | ~10M tokens | ~$0.20 |

Initial sync for most stores costs under $0.05. Ongoing cost per webhook update is fractions of a cent.

---

## Full Query Flow (Phase 2)

```
User: "something gentle on my stomach that gives energy"
             ↓
   Embed query via OpenAI API
   → query_vector = [0.18, -0.40, 0.83, ...]
             ↓
   Apply hard filters (productType, price if specified)
             ↓
   Cosine similarity search against product_embeddings
             ↓
   Top 5 closest products returned
             ↓
   AI formats response with product cards
```

---

## What Phase 2 Fixes vs Phase 1

| User query | Phase 1 | Phase 2 |
|---|---|---|
| "pre-workout" | ✓ finds it | ✓ finds it |
| "energy before gym" | ✓ LLM bridges it | ✓ vector bridges it |
| "gentle on stomach energy" | ✗ word not in data | ✓ semantic match |
| "similar to the pre-workout" | ✗ returns same products | ✓ nearest neighbor search |
| "no caffeine supplement" | ✗ can't express negation | ✓ metadata filter |
| T-shirt with no productType set | ✗ invisible to AI | ✓ embedded from title/tags |

---

## Implementation Order

1. Docker Compose — PostgreSQL + pgvector
2. Prisma schema — `product_embeddings` table
3. `ProductSyncService` — bulk fetch from Shopify + embed + store
4. `VectorSearchService` — query embedding + cosine similarity
5. Replace / augment `search_products` tool with vector search
6. Shopify webhook handler — incremental re-sync on product changes
