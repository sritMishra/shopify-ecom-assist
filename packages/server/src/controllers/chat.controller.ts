import { openai } from '@ai-sdk/openai';
import type { CoreMessage, Message } from 'ai';
import { convertToCoreMessages, streamText } from 'ai';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { getSystemPrompt } from '../prompts/system.prompt';
import { shopifyTools } from '../tools/shopify.tools';
import logger from '../utils/logger';

const chatRequestSchema = z.object({
  messages: z
    .array(
      // passthrough preserves toolInvocations so convertToCoreMessages can reconstruct tool history
      z
        .object({
          role: z.enum(['user', 'assistant']),
          content: z.string(), // assistant messages after a tool call arrive with content: ""
        })
        .passthrough()
    )
    .min(1),
});

// Collapse consecutive same-role messages (e.g. two user messages with no assistant reply between
// them) — OpenAI returns empty content when this happens. Keep the last message in each run.
function deduplicateConsecutive(messages: CoreMessage[]): CoreMessage[] {
  return messages.reduce<CoreMessage[]>((acc, msg) => {
    if (acc.length > 0 && acc[acc.length - 1].role === msg.role) {
      acc[acc.length - 1] = msg;
    } else {
      acc.push(msg);
    }
    return acc;
  }, []);
}

export const chatController = {
  stream: async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    try {
      const systemPrompt = await getSystemPrompt();
      const result = await streamText({
        model: openai(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
        system: systemPrompt,
        messages: deduplicateConsecutive(
          convertToCoreMessages(parsed.data.messages as unknown as Message[])
        ),
        tools: shopifyTools,
        // maxSteps allows the model to call tools and continue — replaces the manual while loop
        maxSteps: 5,
      });

      result.pipeDataStreamToResponse(res, {
        getErrorMessage: (err) => {
          logger.error({ err }, 'Data stream error');
          return err instanceof Error ? err.message : String(err);
        },
      });
    } catch (err) {
      logger.error({ err }, 'Chat stream error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }
    }
  },
};
