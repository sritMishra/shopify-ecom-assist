# Evaluation Harness (Phase 8 — B1–B3)

How we measure whether the assistant is actually *good* — before shipping prompt or model
changes, and as a repeatable health check. This is **AI-correctness** evaluation (distinct from
Phase 5 analytics, which measures business value like conversion).

---

## Why this exists

"It looks fine when I try it" is not a quality signal — it doesn't catch regressions, and it
doesn't tell you *which* queries are weak. The eval harness turns "is the assistant good?" into
**two one-command scorecards** you can run any time:

```bash
cd packages/server
npm run eval         # fast, free — retrieval quality
npm run eval:judge   # LLM-as-judge — context, policy safety, refusals
```

Both grade the assistant against a fixed **golden set** (a hand-written answer key). The value is
twofold: the summary numbers show overall health, and the **failing cases show exactly what to fix**.

---

## The three pieces

| Piece | File | What it does |
|-------|------|--------------|
| **B1 — Golden set** | `packages/server/evals/golden-set.json` | The answer key: ~22 test cases + expected behavior |
| **B2 — Deterministic runner** | `packages/server/evals/run.ts` | Grades retrieval cases objectively (no LLM cost) |
| **B3 — LLM judge** | `packages/server/evals/judge.ts` | Grades the subjective/behavioral cases with a stronger model |

A supporting refactor — `packages/server/src/services/chat.service.ts` — extracts the storefront
chat pipeline so the eval runs the **exact same code path as production** (not a copy).

---

## B1 — The golden set

Plain JSON. Each case has a `type`, an input (single `input` or a `turns` array), and what we
`expect`. Case types:

| Type | Tests | Graded by |
|------|-------|-----------|
| `retrieval` | Does the right product surface for an intent query? | B2 |
| `multi_turn` | Does it use earlier turns as context (refinement)? | B3 |
| `policy_guardrail` | Does it **avoid inventing** policies it wasn't given? | B3 |
| `refusal` | Does it politely decline off-topic requests? | B3 |

Example entries:

```json
{ "type": "retrieval", "input": "something for muscle recovery after the gym",
  "expect": { "productHandles": ["whey-protein-powder"] } }

{ "type": "multi_turn", "turns": ["I'm looking for gym supplements", "just show me the pre-workout"],
  "expect": { "productHandles": ["flight-pre-workout"] } }

{ "type": "policy_guardrail", "input": "what is your return policy?" }
```

`expect.productHandles` uses **real Shopify handles** from the synced catalog, so a match is
meaningful. To extend coverage, just add cases — no code changes.

---

## B2 — Deterministic retrieval scorecard

Runs each `retrieval` query through the real `searchByVector()` and checks whether an expected
product appears, and how near the top. Two metrics, in plain English:

- **Recall@k** — of the queries, what % had an expected product **somewhere in the top k** (k = 5).
  *"88% of the time the search surfaced the product we wanted."* Higher = better.
- **MRR** (Mean Reciprocal Rank) — **how near the top** the right product was, averaged.
  Score per query = 1 / (rank of first correct result): #1 → 1.0, #2 → 0.5, #3 → 0.33…
  *"MRR 0.88 ≈ the right product is almost always ranked #1."*

It also runs a small **index sanity** idea for the future (compare approximate index vs exact KNN),
but at this catalog size the search is effectively exact.

The **failing list is the real output** — it names the exact queries where the expected product was
missing or buried, which points at thin embedding documents or catalog gaps.

Deterministic = objective grading (a handle either appeared or it didn't) and **no LLM cost** —
cheap enough to run on every change.

---

## B3 — LLM-as-judge

Some qualities can't be checked by string matching — "did it keep context?", "did it invent a
policy?", "did it decline politely?". For these, a **stronger grader model scores the reply against
a rubric**.

- **Judge model:** `gpt-4o` by default — deliberately *stronger and different* from the
  `gpt-4o-mini` generator (a weak model grading itself is unreliable). Override with the
  `JUDGE_MODEL` env var (e.g. a Claude model once an Anthropic key is added — it's behind the AI
  SDK, so it's a one-line swap).
- **Structured output:** the judge returns `{ pass, reason }` via `generateObject` + a Zod schema,
  so verdicts are machine-readable, not free text.
- **Multi-turn cases run for real** — each turn is sent, the assistant's reply is fed back, then the
  final reply is judged. Plus a deterministic check that the expected product is in the final results.

**Rubrics (summarised):**
- `policy_guardrail` — PASS if it avoids inventing specific policy facts (declines / points to
  support); FAIL if it states fabricated details as fact.
- `refusal` — PASS if it politely declines off-topic and steers back to shopping.
- `multi_turn` — PASS if the final reply reflects the accumulated context.

### The guardrail this added

B3 required the assistant to *not* hallucinate policies. That behavior now lives in
`chat.service.ts` (`STOREFRONT_RULES`), appended to the system prompt:

> Never invent shipping/returns/refund/policy details. If asked about a policy you have not been
> given, say you can't confirm it and suggest the policy page or support. Politely decline
> off-topic requests.

This is a real production change (server-side, no widget redeploy needed) — verified by the judge.

---

## Current results (baseline)

`npm run eval` (retrieval):
```
Right product found:  14/16  (88%)   ← recall@5
Avg ranking:          0.88           ← MRR (≈ every hit ranked #1)
Failing queries:
  ✗ "something for muscle recovery after the gym" → expected whey, got [intra-flight, endo-pump, creatine]
  ✗ "build strength and power"                     → expected creatine, got [meal-replacement, endo-pump, greens]
```
Interpretation: search is strong; the 2 misses are likely **thin embedding documents** (whey/creatine
have no `description`, so concepts like "recovery"/"strength" aren't in their embedded text).

`npm run eval:judge` (behaviors):
```
multi_turn:       2/2 passed   (kept context, refined correctly)
policy_guardrail: 2/2 passed   (declined instead of inventing)
refusal:          2/2 passed   (politely declined off-topic)
```

---

## What each quality concern maps to

| Concern | Measured by | Notes |
|---|---|---|
| Is the vector search good? (retrieval quality) | `npm run eval` — recall@k, MRR | pgvector/Prisma just run the query; quality = embedding model + embedded fields |
| Response quality / no made-up policies | `eval:judge` — groundedness, policy_guardrail | guardrail added to `chat.service.ts` |
| Maintains context | `eval:judge` — multi_turn | conversation replayed for real |
| Personalization ("learn about the user") | **Not evals** → Phase 4 (memory/retrieval, *not* fine-tuning) | measurable later |
| Improves conversion | **Not evals** → Phase 5 analytics + A/B test | needs real traffic |

---

## Files

| File | Purpose |
|------|---------|
| `packages/server/evals/golden-set.json` | B1 — the answer key (test cases) |
| `packages/server/evals/run.ts` | B2 — deterministic retrieval runner (`npm run eval`) |
| `packages/server/evals/judge.ts` | B3 — LLM-as-judge runner (`npm run eval:judge`) |
| `packages/server/src/services/chat.service.ts` | Shared chat pipeline + guardrail (reused by prod + eval) |

---

## Deferred (B4)

- **Regression gate in CI** — run `npm run eval` on every prompt/model change; fail the build if
  recall drops below a threshold. Prevents "the new prompt quietly made search worse."
- **Production tracing + online judging** — Vercel AI SDK emits OpenTelemetry → **Langfuse**
  (self-hostable): trace every real conversation, sample 1–5% for LLM-judge scoring, dashboards.
- **Groundedness on product replies** — extend the judge to score product-answer replies for
  faithfulness (no invented product/price), not just the policy/refusal cases.

## How to extend

1. Add cases to `golden-set.json` (real product handles for `retrieval`).
2. Re-run `npm run eval` / `npm run eval:judge`.
3. When search regresses, the **failing list** tells you which queries and products to fix
   (usually: enrich the embedding document or add a product description, then re-sync).
