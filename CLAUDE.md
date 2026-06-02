# Shopify AI Shopping Assistant

An AI-powered conversational shopping assistant that lets customers find products using natural language instead of keyword search.

---

## Project Structure

```
shopify-ecom-assistant/
├── docs/
│   ├── requirements.md       # Full product requirements and phase roadmap
│   └── tech-stack.md         # Technology decisions
├── packages/
│   ├── server/               # Express API (Node.js + TypeScript)
│   ├── client/               # React frontend (Vite + MUI) — not started yet
│   └── shared/               # Shared Zod schemas + TypeScript types — not started yet
├── package.json              # npm workspaces root
└── CLAUDE.md                 # This file
```

---

## Tech Stack

**Server:** Node.js 22, Express 4, TypeScript, Prisma (PostgreSQL), Pino, Zod, dotenv  
**Client:** React 18, Vite, MUI v6, TanStack Query, React Hook Form, Zod, Axios  
**AI:** OpenAI (tool calling + streaming) with an AIProvider interface for future swapping  
**Shopify:** Admin GraphQL API (server-side), Storefront API (future)  
**Package manager:** npm workspaces  
**Infra:** Docker Compose (deferred — added after core server/client are working)

---

## Running the Project

```bash
# Install all workspace dependencies (run from root)
npm install

# Start the server (packages/server)
npm run dev:server

# Start the client (packages/client) — not set up yet
npm run dev:client
```

Server runs on `http://localhost:3001`  
Client will run on `http://localhost:5173`

---

## Environment Variables

Copy `packages/server/.env.example` to `packages/server/.env` and fill in:

```
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopify_assistant
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2024-01
```

---

## API Endpoints

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| GET | `/api/health` | Done | Health check |
| POST | `/api/chat` | Pending | SSE streaming chat endpoint |

---

## Implementation Progress

### Done
- [x] npm workspaces monorepo setup
- [x] Server: Express + TypeScript + Pino logging + Zod + dotenv
- [x] Server: `/api/health` endpoint
- [x] Server: nodemon + tsx hot reload in dev
- [x] ESLint + Prettier + Husky pre-commit hook (lint-staged)

### In Progress
- [ ] Prisma schema + PostgreSQL connection
- [ ] Shopify Admin GraphQL client + product search service
- [ ] OpenAI tool calling + SSE streaming chat endpoint
- [ ] Shared types package (`packages/shared`)
- [ ] React client setup
- [ ] Chat UI (ChatWindow, MessageList, MessageInput, ProductCard)
- [ ] Docker Compose (server + client + postgres)

---

## Key Architectural Decisions

**Standalone app** — not embedded in a Shopify theme. Runs as a separate web app.

**Stateless chat** — conversation history is sent from the client with every request. No server-side session storage for Phase 1.

**SSE streaming** — the `/api/chat` endpoint streams tokens using Server-Sent Events. The client uses `fetch` + `ReadableStream` (not `EventSource`) because SSE requires a POST body.

**AIProvider interface** — OpenAI is wrapped behind an interface so swapping to Anthropic or Gemini requires no changes to the chat controller.

**Tool calling loop** — the OpenAI provider runs a `while(true)` loop: stream tokens → if `finish_reason === tool_calls`, execute the Shopify search tool and feed results back → continue streaming until `finish_reason === stop`.

---

## Phase Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Natural language product search, recommendations, conversational refinement, product cards | In progress |
| 2 | Semantic search with OpenAI embeddings + pgvector | Pending |
| 3 | RAG over store knowledge (FAQs, policies, collections) | Pending |
| 4 | Session memory + personalized recommendations | Pending |
