# Shopify AI Shopping Assistant

An AI-powered conversational shopping assistant that lets customers find products using natural language instead of keyword search.

---

## Working Guidelines for Claude

> These rules apply in every session.

1. **Always share a plan before writing code.** Wait for confirmation before implementing.
2. **Go step by step.** Do not scaffold multiple features at once. One logical unit at a time.
3. **After every change, provide:**
   - What was built and why
   - What files were added or modified
   - Exact steps to test the change (curl commands, browser steps, expected output)
4. **Update this file** (`CLAUDE.md`) at the end of every session — tick off completed items and add new endpoints or decisions.

### Production-First Engineering Standard

> Every architectural decision, data storage choice, caching strategy, and infrastructure pattern must be evaluated as if this app will serve **millions of concurrent users** (lakhs to crores of visitors). "Good enough for dev" is not acceptable. Ask: *would this hold under 100k req/min? would this survive a pod restart? would this work across 10 server instances?*

Specifically, this means:
- **No in-memory state** for anything that must survive restarts or scale horizontally (use Redis, PostgreSQL, or a proper distributed store)
- **No single points of failure** — every external call (Shopify, OpenAI) needs timeouts, retries, and circuit breakers
- **Stateless server processes** — any server instance must be able to handle any request without local state
- **Cache with invalidation** — TTL-only caching is a starting point; production needs event-driven invalidation (webhooks)
- **Observability from day one** — structured logging (already using Pino), metrics, and distributed tracing before going live
- **Rate limiting and abuse protection** — per-user, per-store, and global limits on all API endpoints
- **Cost awareness** — every OpenAI call has a price; design prompts and caching to minimise unnecessary LLM calls

---

## Project Structure

```
shopify-ecom-assistant/
├── docs/
│   ├── requirements.md       # Full product requirements and phase roadmap
│   └── tech-stack.md         # Technology decisions
├── packages/
│   ├── server/               # Express API (Node.js + TypeScript)
│   ├── client/               # React frontend (Vite + MUI) — not started yet
│   └── shared/               # Shared Zod schemas + TypeScript types — not started yet
├── package.json              # npm workspaces root
└── CLAUDE.md                 # This file
```

---

## Tech Stack

**Server:** Node.js 22, Express 4, TypeScript, Prisma (PostgreSQL), Pino, Zod, dotenv  
**Client:** React 18, Vite, MUI v6, TanStack Query, React Hook Form, Zod, Axios  
**AI:** OpenAI (tool calling + streaming) with an AIProvider interface for future swapping  
**Shopify:** Admin GraphQL API (server-side), Storefront API (future)  
**Package manager:** npm workspaces  
**Infra:** Docker Compose (deferred — added after core server/client are working)

---

## Running the Project

```bash
# Install all workspace dependencies (run from root)
npm install

# Start the server (packages/server)
npm run dev:server

# Start the client (packages/client) — not set up yet
npm run dev:client
```

Server runs on `http://localhost:3001`  
Client will run on `http://localhost:5173`

---

## Environment Variables

Copy `packages/server/.env.example` to `packages/server/.env` and fill in:

```
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopify_assistant
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2024-01
```

---

## API Endpoints

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| GET | `/api/health` | Done | Health check |
| POST | `/api/chat` | Done | SSE streaming chat endpoint |
| POST | `/api/sync/products` | Done | Trigger full product embedding sync into pgvector |

---

## Implementation Progress

### Phase 1 — Done
- [x] npm workspaces monorepo setup
- [x] Server: Express + TypeScript + Pino logging + Zod + dotenv
- [x] Server: `/api/health` endpoint
- [x] Server: nodemon + tsx hot reload in dev
- [x] ESLint + Prettier + Husky pre-commit hook (lint-staged)
- [x] Shared types: `ChatMessage`, `Product`, `SearchProductsParams`, `StreamCallbacks`
- [x] Shopify Admin GraphQL client + `productService.searchProducts()`
- [x] OpenAI tool calling + SSE streaming (`OpenAIProvider`, `AIProvider` interface)
- [x] `POST /api/chat` — streaming chat endpoint with Zod validation
- [x] Store context: shop name + primary domain URL + product types + collections in system prompt
- [x] System prompt: AI can answer store-related questions (name, URL); only refuses truly off-topic queries

### Phase 2 — Done
- [x] Docker Compose — PostgreSQL + pgvector (`docker-compose.yml` at project root)
- [x] `pgvector` npm package installed in server
- [x] Prisma schema — `product_embeddings` table with `vector(1536)` column
- [x] Database migration ran — table + pgvector extension active
- [x] `src/lib/db.ts` — Prisma client singleton
- [x] `src/services/embedding.service.ts` — `buildEmbeddingDocument()` + `generateEmbeddings()` via Vercel AI SDK
- [x] `src/services/product-sync.service.ts` — cursor-paginated Shopify fetch → embed → upsert pipeline
- [x] `POST /api/sync/products` — manual sync trigger (19 products synced and embedded)
- [x] `src/services/vector-search.service.ts` — cosine similarity search via pgvector `<=>` operator, null-safe hard filters, cosine distance score logging
- [x] Wire vector search into `search_products` tool — `shopify.tools.ts` now calls `searchByVector()` instead of `productService.searchProducts()`
- [ ] Shopify webhook handler — incremental re-sync on product create/update/delete (deferred to post-Phase 2)

### How to test POST /api/chat
```bash
# Basic product search
curl -N -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"show me some products"}]}'

# Conversational refinement (price filter in follow-up)
curl -N -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role":"user","content":"show me some products"},
      {"role":"assistant","content":"Here are some products..."},
      {"role":"user","content":"show me something under 500"}
    ]
  }'
```
Expected: live SSE stream of `token` events followed by a `products` event and a `done` event.

### How to trigger product sync
```bash
curl -X POST http://localhost:3001/api/sync/products
```
Expected: `{ "success": true, "synced": 19, "failed": 0 }`
Must be run whenever products are added/changed until webhook handler (Step 7) is implemented.

### Pending (non-Phase-2)
- [ ] Shared types package (`packages/shared`) — extract when client setup begins
- [ ] React client setup (`packages/client`)
- [ ] Chat UI (ChatWindow, MessageList, MessageInput, ProductCard)

### Phase 6 — Multi-Tenant Productionization & Scale — Pending
> Full detail: `docs/phase-6/phase-6.md`. Turns the single-store dev app into a multi-tenant SaaS
> installable across many Shopify stores that survives real traffic.
- [ ] Shopify OAuth install flow + `tenant_id` everywhere (foundation — currently single-store via `.env`)
- [ ] Per-tenant config table + encrypted API-key storage + provider factory (OpenAI/Claude per store)
- [ ] Rate limiting — per-user / per-tenant / global (Redis-backed); none exists today
- [ ] Provider fallback + stronger retry/backoff + graceful degradation to keyword search
- [ ] Token metering + quotas + usage dashboard (soft-warn 80%, throttle 100%)
- [ ] Webhook-driven incremental sync + background job queue (BullMQ/SQS)
- [ ] Semantic caching (Redis) + DB connection pooling (PgBouncer/Neon pooler)
- [ ] Siloed dedicated-instance option for enterprise clients (later)

**Open decisions (need sign-off before building):** billing model (BYO-key vs bundled tokens) ·
data isolation (pooled `tenant_id` vs table-per-tenant) · embedding model locked to one default ·
fallback provider (Claude / Azure OpenAI).

**Key constraint:** chat provider is swappable per tenant; the **embedding model is not** —
different models produce different-width, incompatible vectors, so changing it requires a full
catalog re-embed. Lock it to one default for all tenants.

---

## Key Architectural Decisions

**Standalone app** — not embedded in a Shopify theme. Runs as a separate web app.

**Stateless chat** — conversation history is sent from the client with every request. No server-side session storage for Phase 1.

**SSE streaming** — the `/api/chat` endpoint streams tokens using Server-Sent Events. The client uses `fetch` + `ReadableStream` (not `EventSource`) because SSE requires a POST body.

**AIProvider interface** — OpenAI is wrapped behind an interface so swapping to Anthropic or Gemini requires no changes to the chat controller.

**Tool calling loop** — the OpenAI provider runs a `while(true)` loop: stream tokens → if `finish_reason === tool_calls`, execute the Shopify search tool and feed results back → continue streaming until `finish_reason === stop`.

**SSE disconnect detection — use `res`, not `req`** — In Express SSE endpoints, always watch `res.on('close')` to detect client disconnects, never `req.on('close')`. The `req` close event fires as soon as the request body is fully read (immediately after `res.flushHeaders()`), which would set the closed flag before the response is even started. Use `res.writableEnded` as the primary guard before calling `res.write()` or `res.end()`.

```typescript
// WRONG — fires immediately after request body is read
req.on('close', () => { closed = true; });

// CORRECT — fires only when client actually drops the connection
let clientGone = false;
res.on('close', () => {
  if (!res.writableEnded) clientGone = true;
});
// And use res.writableEnded as the guard for res.end() calls
```

---

## Key Files Added in Phase 2

| File | Purpose |
|------|---------|
| `docker-compose.yml` | PostgreSQL + pgvector container |
| `packages/server/prisma/schema.prisma` | Database schema |
| `packages/server/prisma/migrations/*/migration.sql` | Migration history |
| `packages/server/src/lib/db.ts` | Prisma singleton — import `prisma` from here |
| `packages/server/src/services/embedding.service.ts` | `buildEmbeddingDocument()`, `generateEmbeddings()` |
| `packages/server/src/services/product-sync.service.ts` | `syncAllProducts()` — full Shopify → pgvector pipeline |
| `packages/server/src/routes/sync.route.ts` | `POST /api/sync/products` |
| `docs/phase-2/phase-2.md` | Problem statement + architecture decisions |
| `docs/phase-2/implementation.md` | Step-by-step implementation log |

---

## Phase Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Natural language product search, recommendations, conversational refinement, product cards | ✅ Done |
| 2 | Semantic search with OpenAI embeddings + pgvector | ✅ Done |
| 3 | RAG over store knowledge (FAQs, policies, collections) | Pending |
| 4 | Session memory + personalized recommendations | Pending |
| 5 | Analytics dashboard — search queries, result quality, conversion tracking | Pending |
| 6 | Multi-tenant productionization & scale (SaaS) — see `docs/phase-6/phase-6.md` | Pending |

> **Phase 6 is a cross-cutting production track, not a feature phase.** It must largely land
> *before* onboarding real paying clients, because it changes the data model (tenant identity),
> the secrets model (per-tenant keys), and the request path (rate limiting, fallback, caching).
