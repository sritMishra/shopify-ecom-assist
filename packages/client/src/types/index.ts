// ── Shared with server (keep in sync manually until packages/shared exists) ──

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
  price: {
    min: ProductPrice;
    max: ProductPrice;
  };
  image: { url: string; altText: string | null } | null;
  url: string;
}
