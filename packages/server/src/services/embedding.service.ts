// embedding.service.ts
//
// Two responsibilities:
//   1. buildEmbeddingDocument — constructs the text we send to OpenAI for a product
//   2. generateEmbeddings     — sends those texts to OpenAI and gets back vectors
//
// Why separate this into its own file?
// The sync service and (later) the search service both need embeddings.
// Keeping embedding logic here means neither service duplicates it.

import { openai } from '@ai-sdk/openai';
import { embedMany } from 'ai';

// ---------------------------------------------------------------------------
// buildEmbeddingDocument
//
// Converts a product's fields into a plain text string.
// This string is what OpenAI "reads" to understand the product's meaning.
//
// The richer the text, the better the embedding captures the product's meaning.
// Order matters — we put the most important fields first (title, type, tags).
//
// Example output:
//   "Product: Optimum Nutrition Gold Standard Whey
//    Type: Supplements
//    Tags: protein, post-workout, muscle-building"
// ---------------------------------------------------------------------------
export function buildEmbeddingDocument(product: {
  title: string;
  productType?: string | null;
  tags?: string[];
  description?: string | null;
}): string {
  const parts = [`Product: ${product.title}`];

  if (product.productType) {
    parts.push(`Type: ${product.productType}`);
  }

  if (product.tags?.length) {
    parts.push(`Tags: ${product.tags.join(', ')}`);
  }

  // Description is optional — products without one still get a useful embedding
  // from title + type + tags. Descriptions make the embedding richer over time.
  if (product.description) {
    parts.push(`Description: ${product.description}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// generateEmbeddings
//
// Takes an array of text strings and returns an array of vectors.
// Each vector is 1536 numbers — one per input string, in the same order.
//
// We use embedMany (batch) rather than calling embed() in a loop because:
//   - One API call instead of N calls → faster and uses fewer API rate limit tokens
//   - OpenAI handles the batching internally
//
// Example:
//   input:  ["Product: Whey Protein\nType: Supplements", "Product: T-Shirt\nType: Apparel"]
//   output: [[0.21, -0.43, ...], [0.72, 0.11, ...]]  (two vectors of 1536 numbers each)
// ---------------------------------------------------------------------------
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

  const { embeddings } = await embedMany({
    model: openai.embedding(model),
    values: texts,
  });

  return embeddings;
}
