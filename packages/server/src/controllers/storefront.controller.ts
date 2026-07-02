// storefront.controller.ts
//
// Endpoint the storefront chat widget calls THROUGH the Shopify App Proxy:
//   storefront /apps/assistant/chat  →  Shopify  →  ngrok  →  POST /api/storefront/chat
//
// Step C (first cut): NON-STREAMING. Returns the full reply + products as JSON
// so we can prove the whole pipe (proxy → backend → vector search → LLM) before
// tackling streaming-through-proxy. Streaming is a later step.

import type { CoreMessage } from 'ai';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { runChat } from '../services/chat.service';
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
      const { reply, products } = await runChat(parsed.data.messages as CoreMessage[]);
      res.json({ reply, products });
    } catch (err) {
      logger.error({ err }, 'Storefront chat failed');
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  },
};
