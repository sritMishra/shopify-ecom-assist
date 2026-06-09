import { useCallback, useRef, useState } from 'react';

import { streamChat } from '@/api/chat';
import type { ChatMessage, Product, UIMessage } from '@/types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface UseChatReturn {
  messages: UIMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // sendMessage has an empty dep array so it never re-creates, but it still needs the latest
  // messages to build the history snapshot. A ref bridges that gap without triggering re-renders.
  const messagesRef = useRef<UIMessage[]>(messages);
  messagesRef.current = messages;

  const sendMessage = useCallback(async (content: string) => {
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMessage: UIMessage = { id: generateId(), role: 'user', content };
    const assistantId = generateId();
    // Empty content + isStreaming:true goes into state immediately so the bubble
    // appears before the first token arrives, preventing a layout shift.
    const assistantMessage: UIMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    // Snapshot history before state update (setMessages is async)
    const history: ChatMessage[] = [...messagesRef.current, userMessage].map(
      ({ role, content: c }) => ({ role, content: c })
    );

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsLoading(true);
    setError(null);

    try {
      await streamChat(
        history,
        {
          onToken: (token) => {
            // Functional updater form is required here — onToken fires many times per second
            // and each call must operate on the latest state, not the stale closure value.
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: msg.content + token } : msg
              )
            );
          },
          onProducts: (products: Product[]) => {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantId ? { ...msg, products } : msg))
            );
          },
          onDone: () => {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantId ? { ...msg, isStreaming: false } : msg))
            );
            setIsLoading(false);
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, isStreaming: false, content: message } : msg
              )
            );
            setError(message);
            setIsLoading(false);
          },
        },
        abortController.signal
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = 'Failed to connect to assistant. Please try again.';
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false, content: msg } : m))
      );
      setError(msg);
      setIsLoading(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, error, sendMessage, clearMessages };
}
