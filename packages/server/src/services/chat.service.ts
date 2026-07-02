// chat.service.ts
//
// The storefront chat pipeline, extracted so BOTH the live endpoint
// (storefront.controller) and the eval harness (evals/judge.ts) run the exact
// same logic. Non-streaming: returns the full reply + products.

import { openai } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import { generateText } from 'ai';

import { getSystemPrompt } from '../prompts/system.prompt';
import { shopifyTools } from '../tools/shopify.tools';
import type { Product } from '../types';

// Storefront-specific behaviour appended to the base system prompt:
//  - keep replies short (product cards render separately)
//  - NEVER invent policies (we have no policy data yet — prevents hallucination)
//  - politely decline off-topic requests
const STOREFRONT_RULES =
  '\n\nSTOREFRONT WIDGET RULES:\n' +
  '- Reply in 1–2 short, friendly sentences. Do NOT list product names, prices, images, or ' +
  'links in your text — product cards are shown separately below your message. Just briefly ' +
  'introduce what you found or ask a clarifying question.\n' +
  '- NEVER invent shipping, returns, refund, or store-policy details. If asked about a policy ' +
  "you have not been given, say you can't confirm it and suggest the store's policy page or " +
  'contacting support.\n' +
  '- For off-topic requests unrelated to shopping at this store, politely decline and steer ' +
  'back to helping them shop.';

export async function runChat(
  messages: CoreMessage[]
): Promise<{ reply: string; products: Product[] }> {
  const systemPrompt = (await getSystemPrompt()) + STOREFRONT_RULES;

  const result = await generateText({
    model: openai(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    system: systemPrompt,
    messages,
    tools: shopifyTools,
    // Lets the model call search_products then write a final reply.
    maxSteps: 5,
  });

  // Products from the search_products tool result (last non-empty search).
  const products =
    result.steps
      .flatMap((s) => (s.toolResults ?? []) as Array<{ toolName: string; result: unknown }>)
      .filter((tr) => tr.toolName === 'search_products')
      .map((tr) => tr.result as Product[])
      .filter((r) => Array.isArray(r) && r.length > 0)
      .pop() ?? [];

  return { reply: result.text, products };
}
