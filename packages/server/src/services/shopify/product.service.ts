import type { Product, SearchProductsParams } from '../../types';
import { shopifyGraphQL } from './shopify.client';

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          description
          productType
          tags
          handle
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          featuredImage {
            url
            altText
          }
          onlineStoreUrl
        }
      }
    }
  }
`;

interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
  handle: string;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
  featuredImage: { url: string; altText: string | null } | null;
  onlineStoreUrl: string | null;
}

interface ShopifySearchResponse {
  products: { edges: { node: ShopifyProductNode }[] };
}

function mapProduct(node: ShopifyProductNode): Product {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? '';
  return {
    id: node.id,
    title: node.title,
    description: node.description,
    productType: node.productType,
    tags: node.tags,
    handle: node.handle,
    price: {
      min: {
        amount: parseFloat(node.priceRangeV2.minVariantPrice.amount),
        currencyCode: node.priceRangeV2.minVariantPrice.currencyCode,
      },
      max: {
        amount: parseFloat(node.priceRangeV2.maxVariantPrice.amount),
        currencyCode: node.priceRangeV2.maxVariantPrice.currencyCode,
      },
    },
    image: node.featuredImage ?? null,
    url: node.onlineStoreUrl ?? `https://${storeDomain}/products/${node.handle}`,
  };
}

export const productService = {
  async searchProducts(params: SearchProductsParams): Promise<Product[]> {
    const { query, minPrice, maxPrice, productType, tags, limit = 5 } = params;

    // Build Shopify search query string — empty string returns all products
    let shopifyQuery = query ?? '';
    if (productType) shopifyQuery += ` product_type:"${productType}"`;
    if (tags?.length) shopifyQuery += tags.map((t) => ` tag:${t}`).join('');

    // Fetch more when price filtering so we have enough after filtering
    const fetchFirst = minPrice !== undefined || maxPrice !== undefined ? 20 : limit;

    const data = await shopifyGraphQL<ShopifySearchResponse>(SEARCH_PRODUCTS_QUERY, {
      query: shopifyQuery,
      first: fetchFirst,
    });

    let products = data.products.edges.map(({ node }) => mapProduct(node));

    if (minPrice !== undefined) {
      products = products.filter((p) => p.price.min.amount >= minPrice);
    }
    if (maxPrice !== undefined) {
      products = products.filter((p) => p.price.min.amount <= maxPrice);
    }

    return products.slice(0, limit);
  },
};
