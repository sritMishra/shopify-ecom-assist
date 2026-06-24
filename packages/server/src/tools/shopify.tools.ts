import { tool } from 'ai';
import { z } from 'zod';

import { searchByVector } from '../services/vector-search.service';
import logger from '../utils/logger';

export const shopifyTools = {
  search_products: tool({
    description:
      'Search for products in the store. Use this whenever the customer asks about products, wants recommendations, or wants to filter/refine results.',
    parameters: z.object({
      query: z
        .string()
        .optional()
        .default('')
        .describe(
          'Describe what the customer is looking for in natural language e.g. "something for muscle recovery", "gentle on stomach energy boost", "similar to pre-workout". The search understands meaning — not just keywords.'
        ),
      minPrice: z.number().optional().describe('Minimum price in store currency'),
      maxPrice: z.number().optional().describe('Maximum price in store currency'),
      productType: z.string().optional().describe('Filter by product type e.g. "Shoes", "Apparel"'),
      tags: z.array(z.string()).optional().describe('Filter by tags e.g. ["nike", "running"]'),
      limit: z.number().optional().describe('Number of results to return (default 5, max 10)'),
    }),
    execute: async (args) => {
      try {
        // Phase 2: vector search — finds products by semantic meaning, not keywords.
        // Same interface as Phase 1 productService.searchProducts() — drop-in swap.
        const results = await searchByVector(args);
        return results;
      } catch (err) {
        logger.error({ err, args }, 'search_products failed');
        // Return empty array — lets the model respond gracefully instead of killing the stream
        return [];
      }
    },
  }),
};
