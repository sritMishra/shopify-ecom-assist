// storefront.controller.ts
//
// Endpoint the storefront chat widget calls THROUGH the Shopify App Proxy:
//   storefront /apps/assistant/chat  →  Shopify  →  ngrok  →  POST /api/storefront/chat
//
// Step C (first cut): NON-STREAMING. Returns the full reply + products as JSON
// so we can prove the whole pipe (proxy → backend → vector search → LLM) before
// tackling streaming-through-proxy. Streaming is a later step.

import { openai } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import { generateText } from 'ai';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { getSystemPrompt } from '../prompts/system.prompt';
import { shopifyTools } from '../tools/shopify.tools';
import type { Product } from '../types';
import logger from '../utils/logger';

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .min(1),
});

// Verify a Shopify App Proxy request signature.
// Shopify appends `signature` = HMAC-SHA256 of the remaining query params,
// sorted by key and joined as `key=value` with NO separator, using the app
// secret. Docs: shopify.dev/docs/apps/build/online-store/app-proxies
function verifyAppProxySignature(query: Request['query'], secret: string): boolean {
  const { signature, ...rest } = query as Record<string, string | string[]>;
  if (!signature || typeof signature !== 'string') return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = rest[key];
      const v = Array.isArray(value) ? value.join(',') : value;
      return `${key}=${v}`;
    })
    .join('');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export const storefrontController = {
  chat: async (req: Request, res: Response) => {
    // --- App Proxy authentication ------------------------------------------
    const secret = process.env.SHOPIFY_API_SECRET;
    if (secret) {
      if (!verifyAppProxySignature(req.query, secret)) {
        logger.warn('Rejected storefront chat — invalid app proxy signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      // Dev convenience: allow unsigned requests until the secret is wired in.
      logger.warn('SHOPIFY_API_SECRET not set — app proxy signature NOT verified (dev only)');
    }

    // --- Validate body ------------------------------------------------------
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    try {
      const basePrompt = await getSystemPrompt();
      // Storefront widget renders product cards separately, so keep the text
      // reply short and conversational — don't repeat product details in prose.
      const systemPrompt =
        basePrompt +
        '\n\nSTOREFRONT WIDGET RULES: Reply in 1–2 short, friendly sentences. Do NOT list ' +
        'product names, prices, images, or links in your text — product cards are shown ' +
        'separately below your message. Just briefly introduce what you found or ask a ' +
        'clarifying question.';

      const result = await generateText({
        model: openai(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
        system: systemPrompt,
        messages: parsed.data.messages as CoreMessage[],
        tools: shopifyTools,
        // Lets the model call search_products then write a final reply.
        maxSteps: 5,
      });

      // Extract products from the search_products tool result (last non-empty
      // search across all steps).
      const products =
        result.steps
          .flatMap((s) => (s.toolResults ?? []) as Array<{ toolName: string; result: unknown }>)
          .filter((tr) => tr.toolName === 'search_products')
          .map((tr) => tr.result as Product[])
          .filter((r) => Array.isArray(r) && r.length > 0)
          .pop() ?? [];

      res.json({ reply: result.text, products });
    } catch (err) {
      logger.error({ err }, 'Storefront chat failed');
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  },
};
