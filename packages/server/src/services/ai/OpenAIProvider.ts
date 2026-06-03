import OpenAI from 'openai';

import { SYSTEM_PROMPT } from '../../prompts/system.prompt';
import type { ChatMessage, StreamCallbacks } from '../../types';
import logger from '../../utils/logger';
import { productService } from '../shopify/product.service';
import type { AIProvider } from './AIProvider.interface';

// Lazy init — avoids crash at import time if OPENAI_API_KEY is not yet loaded
let _client: OpenAI | null = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export class OpenAIProvider implements AIProvider {
  async streamChat(
    messages: ChatMessage[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    callbacks: StreamCallbacks
  ): Promise<void> {
    const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let continueLoop = true;
    while (continueLoop) {
      const stream = await getClient().chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        messages: currentMessages,
        tools,
        stream: true,
      });

      let assistantContent = '';
      let finishReason: string | null = null;
      // Tool call arguments arrive as streamed deltas — buffer them by index
      const toolCallBuffer: Record<number, { id: string; name: string; arguments: string }> = {};

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;

        if (delta.content) {
          assistantContent += delta.content;
          callbacks.onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffer[idx]) {
              toolCallBuffer[idx] = { id: '', name: '', arguments: '' };
            }
            if (tc.id) toolCallBuffer[idx].id += tc.id;
            if (tc.function?.name) toolCallBuffer[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallBuffer[idx].arguments += tc.function.arguments;
          }
        }
      }

      if (finishReason === 'stop' || finishReason === 'length') {
        continueLoop = false;
      }

      if (finishReason === 'tool_calls') {
        const toolCalls = Object.entries(toolCallBuffer)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, tc]) => tc);

        currentMessages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        for (const tc of toolCalls) {
          let result: string;
          try {
            const args = JSON.parse(tc.arguments);
            if (tc.name === 'search_products') {
              const products = await productService.searchProducts(args);
              callbacks.onProducts(products);
              result = JSON.stringify(
                products.map((p) => ({
                  id: p.id,
                  title: p.title,
                  price: p.price.min.amount,
                  currency: p.price.min.currencyCode,
                  productType: p.productType,
                  tags: p.tags,
                }))
              );
            } else {
              result = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
            }
          } catch (err) {
            logger.error({ err, tool: tc.name }, 'Tool execution failed');
            result = JSON.stringify({ error: 'Tool execution failed' });
          }

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }

        // continueLoop stays true — loop again with tool results fed back
      } else {
        continueLoop = false;
      }
    }

    callbacks.onDone();
  }
}
