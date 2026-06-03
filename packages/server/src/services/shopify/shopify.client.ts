import axios from 'axios';

import logger from '../../utils/logger';

export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION ?? '2024-01';

  if (!domain || !token) {
    throw new Error('SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set in .env');
  }

  const url = `https://${domain}/admin/api/${version}/graphql.json`;

  const response = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
    }
  );

  if (response.data.errors) {
    logger.error({ errors: response.data.errors }, 'Shopify GraphQL error');
    throw new Error(`Shopify error: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data.data as T;
}
