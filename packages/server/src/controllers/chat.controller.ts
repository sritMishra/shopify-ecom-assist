import type { Request, Response } from 'express';
import { z } from 'zod';

import { aiService } from '../services/ai/ai.service';
import logger from '../utils/logger';

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1),
      })
    )
    .min(1),
});

function sendSSE(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const chatController = {
  stream: async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Use res.on('close') — not req.on('close').
    // req.close fires as soon as the request body is read (immediately after flushHeaders),
    // which would prevent res.end() from ever being called.
    // res.close only fires when the client actually drops the connection mid-stream.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        logger.warn('Client disconnected before stream finished');
        clientGone = true;
      }
    });

    try {
      await aiService.streamChat(parsed.data.messages, {
        onToken: (token) => {
          if (!clientGone) sendSSE(res, { type: 'token', content: token });
        },
        onProducts: (products) => {
          if (!clientGone) sendSSE(res, { type: 'products', data: products });
        },
        onDone: () => {
          if (!res.writableEnded) {
            sendSSE(res, { type: 'done' });
            res.end();
          }
        },
      });
    } catch (err) {
      logger.error({ err }, 'Chat stream error');
      if (!res.writableEnded) {
        sendSSE(res, { type: 'error', message: 'Something went wrong. Please try again.' });
        res.end();
      }
    }
  },
};
