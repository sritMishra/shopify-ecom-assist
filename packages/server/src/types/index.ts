export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProductPrice {
  amount: number;
  currencyCode: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
  handle: string;
  // Default variant's numeric id for /cart/add.js — null if not yet synced.
  variantId: string | null;
  // All variants for the storefront selector. Empty if not yet synced.
  variants: Array<{ id: string; title: string; available: boolean }>;
  price: {
    min: ProductPrice;
    max: ProductPrice;
  };
  image: { url: string; altText: string | null } | null;
  url: string;
}

export interface SearchProductsParams {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  productType?: string;
  tags?: string[];
  limit?: number;
}
