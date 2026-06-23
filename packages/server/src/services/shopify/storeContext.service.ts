import logger from '../../utils/logger';
import { shopifyGraphQL } from './shopify.client';

const STORE_CONTEXT_QUERY = `
  query StoreContext {
    shop {
      name
      primaryDomain {
        url
      }
    }
    collections(first: 30) {
      edges {
        node {
          title
        }
      }
    }
    productTypes(first: 30) {
      edges {
        node
      }
    }
  }
`;

interface StoreContextResponse {
  shop: { name: string; primaryDomain: { url: string } };
  collections: { edges: { node: { title: string } }[] };
  productTypes: { edges: { node: string }[] };
}

export interface StoreContext {
  shopName: string;
  storeUrl: string;
  collections: string[];
  productTypes: string[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached: { value: StoreContext; expiresAt: number } | null = null;

export async function getStoreContext(): Promise<StoreContext> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const data = await shopifyGraphQL<StoreContextResponse>(STORE_CONTEXT_QUERY);

  const value: StoreContext = {
    shopName: data.shop.name,
    storeUrl: data.shop.primaryDomain.url,
    collections: data.collections.edges.map((e) => e.node.title).filter(Boolean),
    productTypes: data.productTypes.edges.map((e) => e.node).filter(Boolean),
  };

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.info({ shopName: value.shopName }, 'Store context cached');

  return value;
}
