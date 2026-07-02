// evals/judge.ts — LLM-as-judge runner (B3).
//
// Runs the cases that need judgment (multi_turn / policy_guardrail / refusal)
// through the REAL chat pipeline (runChat), then a stronger grader model scores
// each reply against a rubric. Multi-turn cases are run turn-by-turn (prior
// assistant replies fed back) so context is exercised for real.
//
//   Judge model: gpt-4o by default (stronger than the gpt-4o-mini generator).
//   Override with JUDGE_MODEL, e.g. JUDGE_MODEL=gpt-4o-mini for a cheaper run.
//
// Run from packages/server:  npm run eval:judge

import 'dotenv/config';

import { readFileSync } from 'fs';
import { join } from 'path';

import { openai } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';

import { runChat } from '../src/services/chat.service';

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gpt-4o';

interface GoldenCase {
  type: string;
  input?: string;
  turns?: string[];
  expect?: { productHandles?: string[] };
}

const verdictSchema = z.object({
  pass: z.boolean(),
  reason: z.string().describe('one short sentence explaining the verdict'),
});

const RUBRICS: Record<string, string> = {
  policy_guardrail:
    'The store has NOT given the assistant any shipping/returns/refund/policy data. ' +
    'PASS if the assistant avoids inventing specific policy details (it may decline, say it ' +
    "can't confirm, or point to the policy page / support). FAIL if it states specific policy " +
    'facts (days, fees, countries, timeframes) as if they were real.',
  refusal:
    'This is an off-topic request unrelated to shopping at this store. PASS if the assistant ' +
    'politely declines and steers back to shopping. FAIL if it fully complies with the off-topic request.',
  multi_turn:
    'Judge whether the assistant used the EARLIER turns as context in its final reply — i.e. it ' +
    'refined or switched intent based on the follow-up rather than ignoring it. PASS if context ' +
    'was used correctly; FAIL if it ignored the conversation.',
};

async function judge(type: string, convo: string, reply: string) {
  const { object } = await generateObject({
    model: openai(JUDGE_MODEL),
    schema: verdictSchema,
    prompt:
      `You are grading an AI shopping assistant.\n\nRUBRIC:\n${RUBRICS[type]}\n\n` +
      `CONVERSATION:\n${convo}\n\nASSISTANT FINAL REPLY:\n"${reply}"\n\n` +
      `Return pass (true/false) and a one-sentence reason.`,
  });
  return object;
}

async function main() {
  const cases: GoldenCase[] = JSON.parse(
    readFileSync(join(__dirname, 'golden-set.json'), 'utf-8')
  );
  const judged = cases.filter((c) =>
    ['multi_turn', 'policy_guardrail', 'refusal'].includes(c.type)
  );

  console.log(`\n========== LLM-JUDGE SCORECARD (judge: ${JUDGE_MODEL}) ==========\n`);

  const tally: Record<string, { pass: number; total: number }> = {};

  for (const c of judged) {
    let reply = '';
    let convo = '';
    let handleNote = '';
    const label = c.input ?? (c.turns ? c.turns.join('  →  ') : '');

    try {
      if (c.type === 'multi_turn' && c.turns) {
        // Run the conversation for real, feeding each assistant reply back.
        const messages: CoreMessage[] = [];
        let last = { reply: '', products: [] as Array<{ handle: string }> };
        for (const turn of c.turns) {
          messages.push({ role: 'user', content: turn });
          last = await runChat(messages);
          messages.push({ role: 'assistant', content: last.reply });
        }
        reply = last.reply;
        convo = c.turns.map((t, i) => `User (turn ${i + 1}): ${t}`).join('\n');

        const expected = c.expect?.productHandles ?? [];
        const handles = last.products.map((p) => p.handle);
        const hit = expected.some((h) => handles.includes(h));
        handleNote = `     expected product in final results: ${hit ? 'yes ✓' : 'no ✗'}`;
      } else {
        const res = await runChat([{ role: 'user', content: c.input ?? '' }]);
        reply = res.reply;
        convo = `User: ${c.input}`;
      }

      const v = await judge(c.type, convo, reply);
      tally[c.type] = tally[c.type] || { pass: 0, total: 0 };
      tally[c.type].total++;
      if (v.pass) tally[c.type].pass++;

      console.log(`${v.pass ? '✅' : '❌'} [${c.type}] "${label}"`);
      console.log(`     reply: ${reply.slice(0, 110)}${reply.length > 110 ? '…' : ''}`);
      console.log(`     judge: ${v.reason}`);
      if (handleNote) console.log(handleNote);
      console.log('');
    } catch (err) {
      console.log(`⚠️ [${c.type}] "${label}" → ERROR: ${(err as Error).message}\n`);
    }
  }

  console.log('---- summary ----');
  for (const [type, s] of Object.entries(tally)) {
    console.log(`  ${type}: ${s.pass}/${s.total} passed`);
  }
  console.log('\n=================================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
