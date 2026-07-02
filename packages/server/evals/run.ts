// evals/run.ts — deterministic eval runner (B2).
//
// Reads the golden set (B1) and grades the RETRIEVAL cases by running each query
// through the real vector search (searchByVector) and checking whether the
// expected product showed up — and how near the top.
//
//   Recall@k  = % of queries where an expected product was in the top k
//   MRR       = average of 1/(rank of first expected product)  → 1.0 means always #1
//
// Non-retrieval cases (multi_turn / policy_guardrail / refusal) need the full
// LLM pipeline + a judge, so they're listed here but scored in B3.
//
// Run from packages/server:  npm run eval

import 'dotenv/config';

import { readFileSync } from 'fs';
import { join } from 'path';

import { searchByVector } from '../src/services/vector-search.service';

interface GoldenCase {
  type: 'retrieval' | 'multi_turn' | 'policy_guardrail' | 'refusal';
  input?: string;
  turns?: string[];
  expect?: { productHandles?: string[] };
  note?: string;
}

const K = 5;

async function main() {
  const cases: GoldenCase[] = JSON.parse(
    readFileSync(join(__dirname, 'golden-set.json'), 'utf-8')
  );

  const retrieval = cases.filter((c) => c.type === 'retrieval');
  const deferred = cases.filter((c) => c.type !== 'retrieval');

  let hits = 0;
  let rrSum = 0;
  const failures: string[] = [];

  for (const c of retrieval) {
    const expected = c.expect?.productHandles ?? [];
    let handles: string[] = [];
    try {
      const products = await searchByVector({ query: c.input ?? '', limit: K });
      handles = products.map((p) => p.handle);
    } catch (err) {
      failures.push(`  ✗ "${c.input}"  → ERROR: ${(err as Error).message}`);
      continue;
    }

    // Rank (1-based) of the first expected handle in the results; 0 = not found.
    let rank = 0;
    for (let i = 0; i < handles.length; i++) {
      if (expected.includes(handles[i])) {
        rank = i + 1;
        break;
      }
    }

    if (rank > 0) {
      hits++;
      rrSum += 1 / rank;
    } else {
      failures.push(
        `  ✗ "${c.input}"  → expected [${expected.join(', ')}], got [${
          handles.slice(0, 3).join(', ') || 'nothing'
        }]`
      );
    }
  }

  const n = retrieval.length;
  const recallPct = n ? Math.round((hits / n) * 100) : 0;
  const mrr = n ? (rrSum / n).toFixed(2) : '0.00';

  console.log('\n========== EVAL SCORECARD ==========\n');
  console.log(`Retrieval quality (top ${K}):`);
  console.log(`  Right product found:  ${hits}/${n}  (${recallPct}%)   ← recall@${K}`);
  console.log(`  Avg ranking:          ${mrr}        ← MRR (1.00 = always #1)`);

  if (failures.length) {
    console.log(`\n  Failing queries (these are what to fix):`);
    failures.forEach((f) => console.log(f));
  } else {
    console.log(`\n  No failures — every expected product showed up. 🎉`);
  }

  const types = [...new Set(deferred.map((c) => c.type))].join(', ');
  console.log(`\nDeferred to B3 (LLM judge): ${deferred.length} cases  [${types}]`);
  console.log('\n====================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
