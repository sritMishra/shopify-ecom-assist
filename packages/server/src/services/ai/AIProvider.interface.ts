import type OpenAI from 'openai';

import type { ChatMessage, StreamCallbacks } from '../../types';

export interface AIProvider {
  streamChat(
    messages: ChatMessage[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    callbacks: StreamCallbacks
  ): Promise<void>;
}
