import { shopifyTools } from '../../tools/shopify.tools';
import type { ChatMessage, StreamCallbacks } from '../../types';
import { OpenAIProvider } from './OpenAIProvider';

const provider = new OpenAIProvider();

export const aiService = {
  streamChat(messages: ChatMessage[], callbacks: StreamCallbacks): Promise<void> {
    return provider.streamChat(messages, shopifyTools, callbacks);
  },
};
