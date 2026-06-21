# How the Streaming Chat Works — End to End

A deep-dive into every step of what happens when a user sends a message, based on the actual code in this repo. Written to explain *why* things are built the way they are, not just what they do.

---

## The Big Picture

```
User types a message
  → React captures it
    → fetch POST /api/chat (one request, stays open)
      → Express validates it
        → OpenAI streams tokens back to the server
          → Server forwards each token to the browser as it arrives
            → Browser rebuilds the text word by word in the UI
```

No polling. No websockets. One long-lived HTTP connection that stays open until the response is complete.

---

## Part 1 — What is SSE (Server-Sent Events)?

SSE is a technique where the server keeps the HTTP connection open and pushes chunks of data down to the client over time, instead of sending one complete response and closing.

Each chunk follows this exact text format:
```
data: {"type":"token","content":"Hello"}\n\n
```

- Must start with `data: `
- Must end with two newlines `\n\n`
- The content between them is a JSON string

The server calls `res.write()` for each chunk and only calls `res.end()` when it's completely done. Until `res.end()` is called, the connection stays open.

**Why not WebSockets?** SSE is one-directional (server → client) and works over plain HTTP. WebSockets are two-directional and require a protocol upgrade. For streaming AI responses, SSE is simpler and sufficient.

**Why not `EventSource`?** The browser's built-in `EventSource` API only supports GET requests. We need POST (to send the message history in the body). So we use `fetch` + `ReadableStream` manually instead.

---

## Part 2 — The Server Side

### Step 1: Request arrives at the route

**File:** `packages/server/src/routes/chat.route.ts:7`

```typescript
router.post('/', chatController.stream);
```

Every `POST /api/chat` is handled by `chatController.stream`.

---

### Step 2: Validate and set up SSE headers

**File:** `packages/server/src/controllers/chat.controller.ts:24`

```typescript
const parsed = chatRequestSchema.safeParse(req.body);
// Zod checks: messages is an array, each has role + content

res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.flushHeaders(); // sends headers immediately — connection is now open
```

`res.flushHeaders()` is the moment the connection opens. From here, the server can call `res.write()` at any time to push data to the browser.

**Why `res.on('close')` and not `req.on('close')`:**
```typescript
res.on('close', () => {
  if (!res.writableEnded) clientGone = true;
});
```
`req.on('close')` fires as soon as the request body finishes being read — which happens almost immediately after `flushHeaders()`. That would falsely mark the client as gone before any tokens are sent. `res.on('close')` only fires when the client actually drops the connection.

---

### Step 3: OpenAI is called with streaming enabled

**File:** `packages/server/src/services/ai/OpenAIProvider.ts:29`

```typescript
const stream = await getClient().chat.completions.create({
  model: 'gpt-4o-mini',
  messages: currentMessages,
  tools,        // ← the search_products tool definition
  stream: true, // ← OpenAI streams tokens instead of waiting to respond all at once
});
```

`tools` comes from `packages/server/src/tools/shopify.tools.ts`. This is what tells OpenAI that a `search_products` function exists and what arguments it accepts. OpenAI reads the description to decide when to call it.

---

### Step 4: Tokens stream in from OpenAI

**File:** `packages/server/src/services/ai/OpenAIProvider.ts:41`

```typescript
for await (const chunk of stream) {
  const delta = chunk.choices[0].delta;

  if (delta.content) {
    callbacks.onToken(delta.content); // forward each token immediately
  }

  if (delta.tool_calls) {
    // buffer tool call arguments (they arrive in pieces too)
  }
}
```

OpenAI doesn't send the full response at once. It sends one token at a time. Each `chunk` from the `for await` loop is one small piece.

**Example of what OpenAI sends for a generic message:**
```
chunk 1:  delta.content = "Here"
chunk 2:  delta.content = " are"
chunk 3:  delta.content = " some"
chunk 4:  delta.content = " tips"
...
final:    finish_reason = "stop"
```

**Example of what OpenAI sends for a product query:**
```
chunk 1:  delta.tool_calls = [{ index: 0, id: "call_abc", function: { name: "search_pro" } }]
chunk 2:  delta.tool_calls = [{ index: 0, function: { arguments: "{\"quer" } }]
chunk 3:  delta.tool_calls = [{ index: 0, function: { arguments: "y\":\"runn" } }]
chunk 4:  delta.tool_calls = [{ index: 0, function: { arguments: "ing shoes\"}" } }]
final:    finish_reason = "tool_calls"
```

Note: even the tool call arguments arrive in fragments and must be buffered and concatenated before they can be parsed as JSON.

---

### Step 5: Each token is forwarded to the browser immediately

**File:** `packages/server/src/controllers/chat.controller.ts:49`

```typescript
onToken: (token) => {
  res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
}
```

**What the browser actually receives over the wire (raw text):**
```
data: {"type":"token","content":"Here"}\n\n
data: {"type":"token","content":" are"}\n\n
data: {"type":"token","content":" some"}\n\n
data: {"type":"token","content":" tips"}\n\n
```

Each `res.write()` call sends one of these lines immediately without waiting for the others.

---

## Part 3 — What Happens for a Product Query

When OpenAI decides to call `search_products` (because `finish_reason === 'tool_calls'`), the server enters a second loop iteration.

**File:** `packages/server/src/services/ai/OpenAIProvider.ts:71`

### Step 6: Shopify Admin GraphQL is called

**File:** `packages/server/src/services/shopify/product.service.ts:74`

```typescript
// The query string is built from OpenAI's extracted arguments
let shopifyQuery = 'running shoes';
// + any price/type/tag filters

const data = await shopifyGraphQL(SEARCH_PRODUCTS_QUERY, {
  query: shopifyQuery,
  first: 20, // fetches extra when price filtering is active
});
```

**What goes to Shopify (GraphQL query):**
```graphql
query SearchProducts($query: String!, $first: Int!) {
  products(first: 20, query: "running shoes") {
    edges {
      node {
        id title description productType tags handle
        priceRangeV2 { minVariantPrice { amount currencyCode } ... }
        featuredImage { url altText }
        onlineStoreUrl
      }
    }
  }
}
```

**What Shopify returns (simplified):**
```json
{
  "products": {
    "edges": [
      {
        "node": {
          "id": "gid://shopify/Product/123",
          "title": "Nike Air Zoom Running Shoe",
          "priceRangeV2": {
            "minVariantPrice": { "amount": "89.99", "currencyCode": "USD" }
          },
          "featuredImage": { "url": "https://cdn.shopify.com/..." },
          "onlineStoreUrl": "https://your-store.myshopify.com/products/nike-air-zoom"
        }
      }
    ]
  }
}
```

### Step 7: Products are sent to the browser immediately

**File:** `packages/server/src/services/ai/OpenAIProvider.ts:92`

```typescript
callbacks.onProducts(products); // ← fires before OpenAI generates its text summary
```

**What the browser receives:**
```
data: {"type":"products","data":[{"id":"gid://shopify/Product/123","title":"Nike Air Zoom Running Shoe","price":{"min":{"amount":89.99,"currencyCode":"USD"},...},"image":{"url":"https://cdn.shopify.com/..."},...}]}\n\n
```

Product cards render in the browser at this point, before OpenAI has even written a single word of its text summary.

### Step 8: Tool result is fed back to OpenAI

**File:** `packages/server/src/services/ai/OpenAIProvider.ts:111`

```typescript
currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(products) });
// loop continues → OpenAI called again with the product results
// OpenAI now writes a natural language summary
// finish_reason = "stop" this time → tokens stream as normal
```

---

### Step 9: Stream ends

**File:** `packages/server/src/controllers/chat.controller.ts:55`

```typescript
onDone: () => {
  res.write(`data: {"type":"done"}\n\n`);
  res.end(); // ← connection closes here
}
```

**What the browser receives as the final event:**
```
data: {"type":"done"}\n\n
```

---

## Part 4 — The Client Side

### Step 10: The fetch call opens the connection

**File:** `packages/client/src/api/chat.ts:17`

```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages }),
  signal, // AbortSignal — lets us cancel mid-stream
});
```

`fetch` returns as soon as the response **headers** arrive (immediately after `res.flushHeaders()` on the server). At this point `response.body` is a `ReadableStream` — the body is still arriving.

### Step 11: `response.body` is a ReadableStream — what that means

When you `console.log(response)` and see:
```
body: ReadableStream { locked: true }
```

- `ReadableStream` — the response body hasn't fully arrived yet. It's a live stream of data coming in over the network.
- `locked: true` — you've called `.getReader()` on it, so the stream is owned by that reader. This is expected.

You cannot call `response.text()` or `response.json()` on a streaming SSE response because those methods wait for the entire body to arrive before returning. For a stream that stays open for 5–10 seconds, that means waiting 5–10 seconds for any output.

### Step 12: `reader.read()` — the key to understanding how it works

**File:** `packages/client/src/api/chat.ts:41`

```typescript
while (!done) {
  const result = await reader.read(); // ← PAUSES HERE waiting for next chunk
  ...
}
```

`reader.read()` does not return immediately. It **suspends execution** (via `await`) until the server pushes the next chunk down the connection. When a chunk arrives, the `await` resolves, the code processes the chunk, and loops back to wait again.

This is **one HTTP request** with the loop running ~100–300 times per response. Each `reader.read()` call is just waiting on the same open connection.

```
await reader.read()  →  [waits ~30ms]  →  { value: Uint8Array[...], done: false }
await reader.read()  →  [waits ~30ms]  →  { value: Uint8Array[...], done: false }
...
await reader.read()  →  [waits]        →  { value: undefined, done: true }  ← connection closed
```

### Step 13: Why raw bytes need decoding

`result.value` is a `Uint8Array` — raw bytes. Not a string. Example:

```
Uint8Array [100, 97, 116, 97, 58, 32, 123, 34, 116, 121, 112, 101, ...]
```

Those bytes in ASCII are: `d a t a :   { " t y p e " ...`

```typescript
// { stream: true } prevents TextDecoder from flushing a partial multi-byte UTF-8
// sequence at a chunk boundary (e.g. an emoji split across two chunks).
buffer += decoder.decode(value, { stream: true });
```

### Step 14: Why we need a buffer

A single `reader.read()` call might return:
- Exactly one complete SSE event — ideal
- Half an event (chunk boundary mid-JSON)
- Two and a half events

The buffer handles all three cases:

```typescript
const parts = buffer.split('\n\n');
buffer = parts.pop() ?? ''; // last part may be incomplete — keep it for next iteration
```

**Example — chunk arrives mid-event:**
```
Chunk received: 'data: {"type":"token","content":"He'
buffer after decode: 'data: {"type":"token","content":"He'
split('\n\n') → ['data: {"type":"token","content":"He']
parts.pop() keeps it in buffer (no complete event yet)

Next chunk: 'llo"}\n\ndata: {"type":"token","content":" world"}\n\n'
buffer now: 'data: {"type":"token","content":"Hello"}\n\ndata: {"type":"token","content":" world"}\n\n'
split('\n\n') → two complete events + empty string
Both events processed ✓
```

### Step 15: Callbacks update React state

**File:** `packages/client/src/hooks/useChat.ts`

```typescript
onToken: (token) => {
  // Functional updater — required because this fires many times per second.
  // Without (prev =>) each call would read the same stale state from the closure.
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === assistantId ? { ...msg, content: msg.content + token } : msg
    )
  );
},

onProducts: (products) => {
  // Attaches product array to the assistant message — rendered inline below the text bubble
  setMessages((prev) =>
    prev.map((msg) => (msg.id === assistantId ? { ...msg, products } : msg))
  );
},
```

The assistant message was placed in state immediately (with empty content) when the user hit send. This is intentional — the bubble appears before the first token arrives, so the UI doesn't jump when text starts streaming in.

### Step 16: Components render the streaming state

**File:** `packages/client/src/components/MessageList.tsx`

```tsx
{msg.content}
{msg.isStreaming && <Box component="span" sx={{ animation: 'blink 1s step-end infinite' }} />}

{msg.products && msg.products.length > 0 && (
  <ProductGrid products={msg.products} />  // ← renders below the text bubble
)}
```

The blinking cursor span is shown while `isStreaming: true`. Products render inline on the same assistant message that triggered the search.

---

## Full Flow Summary

### Generic message: *"What can you help me with?"*

```
1. MessageInput.tsx       User submits form
2. useChat.ts             Appends user + empty assistant message to state
3. api/chat.ts            fetch POST /api/chat — connection opens
4. chat.controller.ts     Validates body, sets SSE headers, flushHeaders()
5. OpenAIProvider.ts      Calls OpenAI (stream: true) with tools attached
6. OpenAIProvider.ts      OpenAI → finish_reason: "stop" (no tool needed)
7. OpenAIProvider.ts      Each token → callbacks.onToken()
8. chat.controller.ts     res.write("data: {token}\n\n") per token
9. api/chat.ts            reader.read() wakes up per chunk, decodes, parses
10. useChat.ts            setMessages() appends token to assistant bubble
11. MessageList.tsx       Re-renders with new text, auto-scrolls
12. chat.controller.ts    onDone → res.write({done}) → res.end()
13. api/chat.ts           reader.read() → done:true → loop exits
14. useChat.ts            isStreaming: false, isLoading: false
```

### Product query: *"Show me running shoes under $100"*

```
1–5. Same as above

6. OpenAIProvider.ts      OpenAI → finish_reason: "tool_calls"
                          Arguments buffered: { query: "running shoes", maxPrice: 100 }

7. product.service.ts     Builds Shopify query string
                          Fetches 20 products (extra, for price filtering headroom)
                          Calls Shopify Admin GraphQL API

8. product.service.ts     Filters: price.min.amount <= 100
                          Returns sliced Product[]

9. OpenAIProvider.ts      callbacks.onProducts(products) — fires NOW
10. chat.controller.ts    res.write("data: {products: [...]}\n\n")
11. api/chat.ts           Parses products event → callbacks.onProducts()
12. useChat.ts            Attaches products[] to assistant message in state
13. MessageList.tsx       ProductGrid renders below assistant bubble

14. OpenAIProvider.ts     Tool result pushed back into messages array
                          OpenAI called again with product context
                          finish_reason: "stop" → text tokens stream

15–end. Same as generic message flow
```

---

## Why We're Migrating to Vercel AI SDK Next

The entire pipeline described in Parts 2–4 is custom plumbing. The Vercel AI SDK provides this out of the box:

| Custom code | AI SDK replacement |
|-------------|-------------------|
| `api/chat.ts` (60 lines) | `useChat()` hook |
| `useChat.ts` (110 lines) | `useChat()` hook |
| `OpenAIProvider.ts` (126 lines) | `streamText({ tools })` |
| `chat.controller.ts` (70 lines) | `result.toDataStreamResponse()` |
| SSE formatting, buffer parsing, decoder | Gone entirely |

What remains manual: rendering product cards from `message.toolInvocations` (the AI SDK's equivalent of `msg.products`).
