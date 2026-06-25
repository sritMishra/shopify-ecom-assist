# Phase 6 — Multi-Tenant Productionization & Scale

> Turning this from a single-store dev app into a multi-tenant SaaS that can be installed
> across hundreds of Shopify stores and survive real traffic (lakhs–crores of shoppers).

---

## Why This Phase Exists

Phases 1–2 produced a **single-store app**: Shopify credentials live in `.env`, there is one
OpenAI key hardcoded in the chat controller, products are synced manually, and there is no rate
limiting, caching, provider fallback, or tenant isolation. That is correct for development and a
single demo store. It does **not** support the product we actually want: an installable app sold
by subscription to many independent stores.

This phase is the bridge from "a working app" to "a SaaS product." It is a **cross-cutting
production track**, not a feature like Phases 3–5 — it must largely land *before* onboarding real
paying clients, because it changes the data model (tenant identity), the secrets model
(per-tenant keys), and the request path (rate limiting, fallback, caching).

### Honest assessment of the current code

| Concern | Current state |
|---|---|
| Tenant model | ❌ Single store — `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ACCESS_TOKEN` in `.env` |
| AI provider | ❌ Hardcoded `openai(...)` in `chat.controller.ts` — no per-tenant choice, no fallback |
| Retries | ⚠️ Only the Vercel AI SDK default (`maxRetries: 2`) — no jitter, no circuit breaker |
| Rate limiting | ❌ None — `app.ts` has `helmet`, open `cors()`, `json`, `pino` only |
| Caching | ❌ None — every message embeds + calls the LLM |
| Sync | ⚠️ Manual `POST /api/sync/products` — no webhooks, no job queue |
| DB pooling | ❌ Not configured — will exhaust Postgres connections under load |
| Stateless / SSE | ✅ Already stateless with SSE streaming — the foundation is right |

The architecture points the right way. The hardening is missing.

---

## Goals

1. **Multi-tenancy** — one app, installed in many stores, with strict per-tenant data isolation.
2. **Per-tenant AI config** — each store chooses its chat provider (OpenAI / Claude) and supplies
   its own API key(s).
3. **Cost & quota control** — meter token usage per tenant; warn and throttle before overspend.
4. **Resilience at scale** — rate limiting, retries+backoff, provider fallback, semantic caching,
   and graceful degradation so the assistant never hard-fails a shopper.
5. **Automated sync** — webhook-driven incremental embedding + a background job queue.

---

## 1. Multi-Tenancy

### Tenant identity — become a real Shopify App

Today credentials are hardcoded. To serve many stores the app must implement the **Shopify OAuth
install flow**: a merchant installs the app → Shopify issues a per-shop access token → the app
stores it. The **shop domain** (`their-store.myshopify.com`) becomes the natural `tenant_id`.
Every incoming request is resolved to a tenant by shop domain (Shopify embedded app) or by an app
API key / subdomain (standalone widget).

### Data isolation — pooled vs table-per-tenant

The single biggest, hardest-to-reverse decision in this phase.

| | Table-per-tenant | Pooled (`tenant_id` column) — **recommended** |
|---|---|---|
| Isolation | Physical — no cross-tenant leak possible | Logical — enforced by `WHERE tenant_id =` |
| Offboarding | `DROP TABLE` | `DELETE WHERE tenant_id` |
| Schema migrations | Must run across **every** table | One table, one migration |
| New tenant | `CREATE TABLE` + index at install | Just insert rows |
| Scales to 1,000+ | Painful (thousands of tables/indexes) | Yes, cleanly |

**Recommendation:** pooled — add `tenant_id` to `product_embeddings`, filter every query
(including the pgvector `<=>` cosine search) by `tenant_id`. Reserve **siloed dedicated instances**
for a small number of enterprise clients who pay for physical isolation. Start pooled; "graduate"
big clients later — same codebase, different deployment config.

### Per-tenant configuration

Each tenant has a config row. Sketch (to be finalised — see Open Decisions):

```
tenants
  id / shop_domain        (tenant_id)
  shopify_access_token    (encrypted)
  chat_provider           'openai' | 'anthropic'
  chat_model              e.g. 'gpt-4o-mini' | 'claude-sonnet-4-6'
  chat_api_key            (encrypted)
  embedding_provider      LOCKED — see §2
  embedding_model         e.g. 'text-embedding-3-small'
  embedding_dimension     e.g. 1536
  embedding_api_key       (encrypted)  — may differ from chat key
  token_quota_monthly     numeric
  sync_status             'pending' | 'syncing' | 'ready' | 'error'
  created_at / updated_at
```

### Secrets — per-tenant, encrypted

API keys are **never** stored in plaintext. Use envelope encryption (cloud KMS, or libsodium with
a master key held outside the DB). Decrypt in memory at request time only.

---

## 2. Provider Abstraction (OpenAI ↔ Claude)

The `AIProvider` interface + Vercel AI SDK already make swapping the **chat** model trivial —
resolve the model per tenant from config:

```ts
const model = tenant.chat_provider === 'anthropic'
  ? anthropic(tenant.chat_model)   // key injected from decrypted tenant config
  : openai(tenant.chat_model);

streamText({ model, system, messages, tools });
```

### ⚠️ Embeddings are NOT swappable the same way

Embedding models produce **different-width vectors** that are geometrically incompatible:

```
OpenAI text-embedding-3-small  → 1536 dims
OpenAI text-embedding-3-large  → 3072 dims
Voyage voyage-3                → 1024 dims
```

The column is `vector(1536)` — fixed width. Two hard consequences:

1. You **cannot** query an OpenAI-embedded catalog with Claude/Voyage vectors.
2. Changing a tenant's embedding model invalidates **every stored vector** — it requires a full
   catalog re-embed and possibly a different-width column.

**Decision: decouple the two.** Let tenants pick only the **chat** provider. **Lock the embedding
model** to one default (e.g. OpenAI `text-embedding-3-small`) for all tenants — shoppers never see
it and there is no customer benefit to exposing it. If chat is Claude but embeddings stay OpenAI,
the tenant must supply **two keys** (Anthropic + OpenAI). Plan the UI for a key-per-provider.

---

## 3. Token Budgeting & Quotas

### Two billing models

- **BYO-key (recommended to start)** — the merchant supplies their own LLM key and pays the
  provider directly. Zero token-cost risk for us. Bonus: each tenant gets their **own rate-limit
  bucket and billing cap**, so one store's traffic can never throttle another (see §4).
- **Bundled tokens** — we buy tokens wholesale, meter, and bill. We carry the float and overage
  risk, so quotas become mandatory.

### Metering

- The AI SDK returns `usage` (prompt/completion tokens) per call. Emit a `llm_call` event with
  tokens, cost, latency, and provider, tagged with `tenant_id`.
- Keep a fast Redis counter per tenant per month (`tenant:{id}:tokens:{yyyymm}`) plus a durable
  `usage_events` row for reporting.
- Enforce quota: soft-warn at 80% (email the merchant), throttle / hard-stop at 100%.

This directly answers "make sure a client does not run out of tokens" — proactive alerts + a
usage dashboard + a pre-call quota check.

---

## 4. Performance & Resilience

### The reframe — the LLM provider is the bottleneck, not the server

A stateless Express + SSE fleet scales to millions of shoppers by adding instances. What breaks is
the part we do not control: every message is an LLM call that **costs money, takes 1–10s, and is
rate-limited**. (Every search also fires an embedding call — a second rate-limited call per
message.) So scaling is mostly a provider-capacity and cost problem.

### What happens at OpenAI's limit

Two different limits, two different failure modes:

1. **Rate limits (RPM / TPM)** — per-minute caps for your tier. Exceed → HTTP `429
   rate_limit_exceeded`. Transient; clears in seconds; tiers auto-raise with spend history.
2. **Quota / billing cap** — monthly spend ceiling. Hit → `429 insufficient_quota`. Does **not**
   clear until the cap is raised or the month resets.

Today both surface to the shopper as `"Something went wrong"` after the SDK's 2 retries. That is
unacceptable at scale.

### The resilience playbook (priority order)

1. **Client-side rate limiting / request queuing** — a token bucket so we never exceed provider
   TPM/RPM; queue excess briefly instead of 429ing. Biggest single stability win. Also abuse
   protection (per-end-user + per-tenant + global).
2. **Retry with exponential backoff + jitter** — stronger than the SDK default; jitter prevents
   retry stampedes.
3. **Provider / model fallback** — on 429 or outage, fail over OpenAI → Claude (or Azure OpenAI,
   which has separate quota). A few lines given the `AIProvider` interface.
4. **Graceful degradation** — if all LLMs are throttled, fall back to **Phase 1 keyword search** +
   a templated reply, or a "high demand, try again" message. Never hard-fail the shopper.
5. **Semantic caching** — many shoppers ask near-identical things ("running shoes", "gift for
   wife"). Cache query embedding + product results in Redis, keyed by the normalised/embedded
   query. Cache hits cost ~$0 and return instantly — can cut LLM calls 30–60% on a busy store.
6. **Higher tier / limit increases** — request increases from the provider; enterprise commitments
   for guaranteed throughput.
7. **DB connection pooling** — PgBouncer / Neon pooler. The *other* thing that breaks under load,
   independent of the LLM, once many app instances each open Postgres connections.

### The BYO-key advantage for scale

If each store brings its own key, each tenant has its **own** rate-limit and billing bucket — a
busy store throttles only itself, and raising limits is the merchant's action. This makes "millions
of shoppers across 100 stores" tractable without us building a shared key pool. A shared key makes
us the bottleneck for everyone and forces the full playbook above. **Scaling resilience and the
billing model are the same decision.**

---

## 5. Sync at Scale

Manual sync does not work for many stores. Replace with:

- **On install** → enqueue a background sync job (BullMQ on Redis, or SQS). The UI shows progress
  ("Syncing… 320/5000"); chat unlocks when `sync_status = ready`. Never embed inline in the OAuth
  callback — large catalogs would time out the install.
- **Ongoing** → Shopify `products/create | update | delete` webhooks re-embed only the changed
  product. (This is the Phase 2 deferred item — now mandatory.)
- **Manual "Sync now"** → re-enqueues the same job; kept as a fallback / escape hatch.

---

## Target Infra Topology

```
                    ┌─────────────┐
   Shoppers ───────▶│ Load Balancer│ (long-lived SSE connections)
                    └──────┬───────┘
                           │
            ┌──────────────┴──────────────┐
            │  Stateless Express fleet     │  (autoscaled, any instance serves any tenant)
            │  - tenant resolution         │
            │  - rate limiting             │
            │  - provider factory + fallbk │
            └───┬──────────┬──────────┬────┘
                │          │          │
        ┌───────▼──┐  ┌────▼─────┐ ┌──▼──────────────┐
        │ Postgres │  │  Redis   │ │ LLM providers    │
        │ +pgvector│  │ - limits │ │ OpenAI / Claude  │
        │ (pooled, │  │ - cache  │ │ (per-tenant keys)│
        │  pooler) │  │ - usage  │ └──────────────────┘
        └──────────┘  │ - queue  │
                      └────┬─────┘
                           │
                    ┌──────▼───────┐
                    │ Worker fleet  │ (sync + embedding jobs, webhook processing)
                    └───────────────┘
```

---

## Implementation Order

1. **Shopify OAuth app + `tenant_id` everywhere** — the foundation; nothing else works without it.
2. **Per-tenant config table + encrypted key storage + provider factory** — unlocks OpenAI/Claude
   choice per store.
3. **Rate limiting (per-user / per-tenant / global, Redis-backed)** — cheapest, biggest stability
   and abuse-protection win.
4. **Provider fallback + stronger retry/backoff + graceful degradation to keyword search.**
5. **Token metering + quotas + usage dashboard.**
6. **Webhook-driven sync + background job queue.**
7. **Semantic caching + DB connection pooling.**
8. **Siloed-instance option** — only when an enterprise client pays for it.

---

## Open Decisions (need owner sign-off before building)

1. **Billing model** — BYO-key (zero token risk, easiest scaling) vs bundled tokens (we meter +
   bill, carry risk). Shapes §3 and §4.
2. **Data isolation** — pooled `tenant_id` (recommended) vs table-per-tenant. Hard to reverse.
3. **Embedding model** — confirm it is locked to one default for all tenants (recommended) rather
   than a user-facing dropdown.
4. **Fallback provider** — Claude, Azure OpenAI, or both, as the failover target.
