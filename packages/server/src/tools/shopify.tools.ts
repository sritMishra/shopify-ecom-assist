import type OpenAI from 'openai';

export const shopifyTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Search for products in the store. Use this whenever the customer asks about products, wants recommendations, or wants to filter/refine results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search keywords e.g. "running shoes", "blue cotton shirt", "whey protein"',
          },
          minPrice: {
            type: 'number',
            description: 'Minimum price in store currency',
          },
          maxPrice: {
            type: 'number',
            description: 'Maximum price in store currency',
          },
          productType: {
            type: 'string',
            description: 'Filter by product type e.g. "Shoes", "Apparel"',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags e.g. ["nike", "running"]',
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (default 5, max 10)',
          },
        },
        required: ['query'],
      },
    },
  },
];
