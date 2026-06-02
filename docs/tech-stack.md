# Technology Stack

## Frontend

### Core Framework

* React
* TypeScript
* Vite

### UI

* Material UI (MUI)
* MUI Icons

### State & Data Management

* TanStack Query
* React Context API

### Forms & Validation

* React Hook Form
* Zod

### API Layer

* Axios

---

# Backend

## Runtime

* Node.js

## Framework

* Express.js

## Language

* TypeScript

## API Validation

* Zod

## Logging

* Pino

## Environment Management

* dotenv

---

# Database

## Primary Database

* PostgreSQL

## ORM

* Prisma

## Future RAG Support

Phase 2:

* pgvector

---

# AI Stack

## LLM Provider

* OpenAI

## AI Features

Phase 1:

* Chat Completions / Responses API
* Function Calling (Tool Calling)

Phase 2:

* Embeddings API
* Semantic Search
* Retrieval-Augmented Generation (RAG)

## Provider Abstraction

Create an internal AIProvider interface to support:

* OpenAI
* Anthropic
* Gemini
* Local Models (Future)

without major refactoring.

---

# Shopify Integration

## APIs

* Shopify Admin GraphQL API

Future:

* Shopify Storefront API

## Services

* Product Service
* Product Sync Service
* Search Service

---

# Testing Strategy

## Frontend Unit Testing

* Vitest
* React Testing Library

## Backend Unit Testing

* Vitest

## Integration Testing

* Supertest

## End-to-End Testing

* Playwright

---

# Code Quality

## Linting

* ESLint

## Formatting

* Prettier

## Import Sorting

* eslint-plugin-simple-import-sort

## Type Safety

* TypeScript Strict Mode

---

# Git Workflow

## Commit Hooks

* Husky

## Staged File Checks

* lint-staged

## Optional

* Commitlint

This can enforce commit conventions such as:

feat:
fix:
refactor:
test:
docs:

---

# Documentation

## Markdown Documentation

* README.md
* docs/product-requirements.md
* docs/architecture.md
* docs/implementation-roadmap.md

## API Documentation (Future)

* Swagger/OpenAPI

---

# Developer Experience

## Package Manager

Choose one:

* npm
* pnpm (Recommended)

## Environment Variables

* .env
* .env.example

## Path Aliases

Examples:

@components
@services
@hooks
@utils

## Hot Reloading

* Vite
* Nodemon

---

# Observability

## Logging

* Pino

## Request Logging

* pino-http

Future:

* OpenTelemetry

---

# Security

## API Security

* Helmet

## CORS

* cors

## Request Validation

* Zod

## Rate Limiting

Future:

* express-rate-limit

---

# Containerization

Phase 1 (Optional)

* Docker

Phase 2

* Docker Compose

Services:

* Client
* Server
* PostgreSQL

---

# CI/CD

Future

## GitHub Actions

Checks:

* Lint
* Unit Tests
* Integration Tests
* Build Validation

---

# Deployment

## Frontend

* Vercel

## Backend

Choose one:

* Railway (Recommended)
* Render
* Fly.io

## Database

* Railway PostgreSQL
* Neon PostgreSQL

---

# Future Expansion

These technologies are intentionally deferred until the core product is validated.

## AI Frameworks

* Vercel AI SDK
* LangChain
* LangGraph

## Vector Databases

Alternative options to pgvector:

* Pinecone
* Weaviate
* Qdrant
* Milvus

## Advanced AI Features

* AI Agents
* Multi-Agent Systems
* Voice Search
* Image Search
* Recommendation Engine
* Personalized Shopping Assistant
