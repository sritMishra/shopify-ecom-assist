import { tool } from 'ai';
import { z } from 'zod';

import { productService } from '../services/shopify/product.service';
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
          'Search keywords e.g. "running shoes", "blue cotton shirt", "whey protein". Omit or pass empty string to search all products.'
        ),
      minPrice: z.number().optional().describe('Minimum price in store currency'),
      maxPrice: z.number().optional().describe('Maximum price in store currency'),
      productType: z.string().optional().describe('Filter by product type e.g. "Shoes", "Apparel"'),
      tags: z.array(z.string()).optional().describe('Filter by tags e.g. ["nike", "running"]'),
      limit: z.number().optional().describe('Number of results to return (default 5, max 10)'),
    }),
    execute: async (args) => {
      logger.info({ args }, 'search_products called');
      try {
        const results = await productService.searchProducts(args);
        logger.info({ count: results.length }, 'search_products returned');
        return results;
      } catch (err) {
        logger.error({ err, args }, 'search_products failed');
        // Return empty array — lets the model respond gracefully instead of killing the stream
        return [];
      }
    },
  }),
};
