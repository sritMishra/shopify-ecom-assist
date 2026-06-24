# Phase 2 — Implementation Progress

---

## Status Overview

| Step | What | Status |
|------|------|--------|
| 1 | Docker Compose — PostgreSQL + pgvector | ✅ Done |
| 2 | Prisma schema — `product_embeddings` table | ✅ Done |
| 3 | Database migration | ✅ Done |
| 4 | ProductSyncService + sync endpoint | ✅ Done |
| 5 | VectorSearchService | 🔲 Next |
| 6 | Wire vector search into chat tool | 🔲 Pending |
| 7 | Shopify webhook handler (incremental sync) | 🔲 Pending |

---

## Step 1 — Docker Compose ✅

**File:** `docker-compose.yml` (project root)

Runs PostgreSQL 16 with the pgvector extension pre-installed using the official `pgvector/pgvector:pg16` image. Data is persisted in a named Docker volume (`postgres_data`) so it survives container restarts.

```bash
docker compose up -d     # start
docker compose down      # stop
docker compose ps        # check status
```

Container name: `shopify_assistant_db`
Port: `5432` (mapped to localhost)

---

## Step 2 — Prisma Schema ✅

**File:** `packages/server/prisma/schema.prisma`

Defines the `product_embeddings` table. Key decisions:

- `embedding Unsupported("vector(1536)")` — Prisma doesn't natively understand the pgvector type so it's declared as Unsupported. The column is created correctly in PostgreSQL but all vector operations use raw SQL (`$executeRaw` / `$queryRaw`).
- `previewFeatures = ["postgresqlExtensions"]` — required for Prisma 5.x to support `extensions = [vector]`.
- `shopifyId` has a `@unique` constraint — enables safe upsert on re-sync without duplicating rows.
- All metadata columns (`productType`, `priceMin`, `priceMax`, etc.) are stored as regular columns for hard filtering in SQL before vector ranking.

---

## Step 3 — Migration ✅

**File created by Prisma:** `packages/server/prisma/migrations/20260623184845_init_product_embeddings/migration.sql`

The migration:
1. Ran `CREATE EXTENSION IF NOT EXISTS "vector"` — activated pgvector
2. Created the `product_embeddings` table with all columns
3. Created a unique index on `shopify_id`

Prisma also auto-generated the TypeScript client after migration.

**Verify anytime:**
```bash
docker exec shopify_assistant_db psql -U postgres -d shopify_assistant -c "\d product_embeddings"
```

---

## Step 4 — ProductSyncService ✅

### New files

| File | Purpose |
|------|---------|
| `packages/server/src/lib/db.ts` | Prisma client singleton — shared DB connection across all server files |
| `packages/server/src/services/embedding.service.ts` | Builds embedding documents from product fields; calls OpenAI `embedMany` for batch embedding |
| `packages/server/src/services/product-sync.service.ts` | Fetches all Shopify products with cursor pagination, embeds per page, upserts into PostgreSQL |
| `packages/server/src/routes/sync.route.ts` | `POST /api/sync/products` trigger endpoint |

### Modified files

| File | Change |
|------|--------|
| `packages/server/src/app.ts` | Added `syncRouter` at `/api/sync` |
| `packages/server/package.json` | Added `db:migrate` and `db:generate` scripts |
| `packages/server/.env` | Uncommented `DATABASE_URL`; added `OPENAI_EMBEDDING_MODEL` |
| `packages/server/.env.example` | Added `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` |

### How the sync pipeline works

```
POST /api/sync/products
        ↓
syncAllProducts()
        ↓
Loop: fetch 50 products per page from Shopify (cursor pagination)
        ↓
buildEmbeddingDocument() per product
  → "Product: {title}\nType: {type}\nTags: {tags}"
        ↓
generateEmbeddings() — one OpenAI API call per page (batch)
  → number[][] — one vector of 1536 numbers per product
        ↓
upsertProductEmbedding() — raw SQL INSERT ... ON CONFLICT DO UPDATE
        ↓
Next page until hasNextPage = false
```

### Vector serialisation

The `pgvector` npm package was not used due to a TypeScript module resolution conflict with `moduleResolution: "node"`. Instead, a local `toVectorSql()` helper serialises the JS number array to the SQL string format pgvector expects:

```typescript
function toVectorSql(vector: number[]): string {
  return '[' + vector.join(',') + ']';
}
// [0.21, -0.43, 0.87] → '[0.21,-0.43,0.87]'
```

### Trigger the sync

```bash
curl -X POST http://localhost:3001/api/sync/products
```

Expected response:
```json
{ "success": true, "synced": 19, "failed": 0, "message": "Synced 19 products. 0 failed." }
```

### Verify in database

```bash
# See all rows
docker exec shopify_assistant_db psql -U postgres -d shopify_assistant \
  -c "SELECT shopify_id, title, product_type, price_min FROM product_embeddings;"

# Confirm embeddings are stored (not null)
docker exec shopify_assistant_db psql -U postgres -d shopify_assistant \
  -c "SELECT title, LEFT(embedding::text, 40) FROM product_embeddings LIMIT 5;"
```

---

## Phase 1 Fixes Made During Phase 2 Session

These were bugs/gaps discovered while testing Phase 1 before starting Phase 2:

| Fix | File | What changed |
|-----|------|-------------|
| Store URL added to system prompt | `storeContext.service.ts` | Added `primaryDomain { url }` to Shopify query; exposed as `storeUrl` in context |
| System prompt too restrictive | `system.prompt.ts` | AI now answers store-related questions (name, URL) instead of refusing them as "outside domain" |
| Verbose store context log | `storeContext.service.ts` | Removed full productTypes/collections dump from log; now logs only `shopName` |
| Redundant tool call logs | `shopify.tools.ts` | Removed `search_products called` (full args) and `search_products returned` logs |
| Search query visibility | `product.service.ts` | Added `🔍 [SEARCH]` log showing `openai_query` and `shopify_query` for debugging |

---

## Step 5 — VectorSearchService 🔲 (Next)

### Concept: How pgvector cosine search works

**pgvector itself understands nothing.**

pgvector is purely a math engine. All it does is:
- Store arrays of numbers in a column
- Compute the angle between two arrays (`<=>` operator)
- Sort rows by that angle

The language understanding — synonyms, context, intent — lives entirely in the **OpenAI embedding model**. It was trained on billions of documents and learned that certain concepts appear in similar contexts. That knowledge is baked into the model permanently.

```
OpenAI embedding model   →  understands language, synonyms, context
        ↓  converts text to coordinates (1536 numbers)
pgvector                 →  stores coordinates, computes angles, sorts
```

OpenAI does the thinking. pgvector does the geometry.

---

**What cosine similarity actually is**

Every product embedding is a point in 1536-dimensional space. Cosine similarity measures the **angle** between two vectors — the direction they point from the origin, not the distance between endpoints.

```
angle = 0°   → identical meaning  → cosine distance = 0.0  (perfect match)
angle = 90°  → unrelated          → cosine distance = 1.0
angle = 180° → opposite meaning   → cosine distance = 2.0
```

pgvector's `<=>` operator returns cosine distance. You sort ascending — smallest angle first = most similar first.

---

**Concrete example with your store data**

At sync time, OpenAI placed each product as a point in 1536D space:

```
"Optimum Nutrition Whey\nType: Supplements\nTags: protein, post-workout"
→ point A = [0.021, -0.013, 0.087, ...]

"Pre-workout energy booster\nType: Supplements\nTags: energy, focus"
→ point B = [0.019, -0.011, 0.085, ...]

"Classic Cotton T-Shirt\nType: T-Shirts\nTags: casual, cotton"
→ point C = [0.072,  0.091, -0.034, ...]
```

User asks: *"something for muscle recovery after gym"*

OpenAI embeds the query using the **same model** → same 1536D space:
```
query = [0.020, -0.012, 0.086, ...]
```

pgvector computes the angle between the query and every stored product:
```
query <=> point A (whey protein)  = 0.08  ← very close, small angle
query <=> point B (pre-workout)   = 0.21  ← somewhat close
query <=> point C (t-shirt)       = 1.43  ← far away, large angle
```

Sort ascending → whey protein comes first. No keywords matched. Pure geometry.

"Muscle recovery" lands near "whey protein" because the embedding model learned from billions of documents — gym articles, nutrition guides, product descriptions — where those concepts always appeared together.

---

**Why pgvector does NOT understand synonyms — the OpenAI model does**

If you switched to a poor embedding model trained on less data, the vectors would be meaningless, the angles random, and the results garbage — even though pgvector's math would still be correct. The quality of semantic search is entirely determined by the embedding model quality, not pgvector.

---

### Plan: one new file

**File:** `packages/server/src/services/vector-search.service.ts`

Takes a user query string, embeds it using the same OpenAI model, applies optional hard filters (productType, price) as SQL WHERE clauses, then ranks the filtered pool by cosine distance. Returns products in the same `Product` shape the chat tool already expects.

```sql
-- Hard filters run first (exact SQL match — fully predictable)
-- Vector ranking runs on the filtered pool (semantic — flexible)
SELECT *
FROM product_embeddings
WHERE product_type = $1          -- optional hard filter
  AND price_min <= $2            -- optional price filter
ORDER BY embedding <=> $3::vector  -- cosine similarity ranking
LIMIT 5;
```

**Supported filters:**

| Filter | Mechanism |
|---|---|
| `productType` | `WHERE product_type = $1` |
| `minPrice` / `maxPrice` | `WHERE price_min >= $2 AND price_min <= $3` |
| `limit` | `LIMIT N` |

Returns the same `Product` type the chat already uses — `id`, `title`, `price`, `image`, `url`, `tags` — so Step 6 is a drop-in swap with no changes to the AI or the SSE stream.
