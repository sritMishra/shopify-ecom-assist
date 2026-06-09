import type { ChatMessage, Product, SSEEvent } from '@/types';

export interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onProducts: (products: Product[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// EventSource only supports GET — we need POST with a JSON body, so we use fetch + ReadableStream instead.
export async function streamChat(
  messages: ChatMessage[],
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  console.log('messages==>', messages);
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  console.log('response==>', response);
  const reader = response.body.getReader();

  console.log('reader==>', reader);

  const decoder = new TextDecoder();
  let buffer = '';

  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    // console.log("result.done==>",result)
    if (result.done || !result.value) break;
    const value = result.value;

    // console.log("value==>",value)

    // { stream: true } prevents TextDecoder from flushing a partial multi-byte UTF-8 sequence at a chunk boundary.
    buffer += decoder.decode(value, { stream: true });
    console.log('buffer==========>', buffer);

    // SSE lines: "data: {...}\n\n" — split on double-newline to get complete events
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? ''; // last part may be incomplete — keep buffered

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;

      const jsonStr = line.slice(6);
      let event: SSEEvent;
      try {
        event = JSON.parse(jsonStr) as SSEEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case 'token':
          callbacks.onToken(event.content);
          break;
        case 'products':
          callbacks.onProducts(event.data);
          break;
        case 'done':
          callbacks.onDone();
          return;
        case 'error':
          callbacks.onError(event.message);
          return;
      }
    }
  }
}
