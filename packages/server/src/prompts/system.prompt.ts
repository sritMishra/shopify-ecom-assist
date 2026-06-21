import { getStoreContext } from '../services/shopify/storeContext.service';
import logger from '../utils/logger';

const BASE_RULES = `
Rules:
- Always use the search_products tool when the customer asks about products — never guess or make up products.
- Use context from earlier in the conversation to refine searches. If a customer says "only Nike" or "under 5000", apply those filters to the previous search intent.
- After showing products, briefly explain why they are a good fit in 1-2 sentences.
- If the customer's request is too vague, ask ONE focused clarifying question — but only within the categories this store actually sells. Never ask about categories outside this store's inventory.
- If no products match, say so honestly and suggest a different search angle.
- Keep your text responses short — the product cards handle the visual detail.
- If asked anything outside of products, this store, or shopping-related topics, respond that it is outside your domain.`;

export async function getSystemPrompt(): Promise<string> {
  try {
    const ctx = await getStoreContext();

    const storeLines: string[] = [`You are a helpful AI shopping assistant for "${ctx.shopName}".`];

    if (ctx.productTypes.length > 0) {
      storeLines.push(
        `This store sells ONLY the following product types: ${ctx.productTypes.join(', ')}.`
      );
    }

    if (ctx.collections.length > 0) {
      storeLines.push(`Available collections in this store: ${ctx.collections.join(', ')}.`);
    }

    storeLines.push(
      `When a customer asks to "see products" or "show me something", search within this store's actual inventory — do NOT ask them whether they want clothing, electronics, or any other category unrelated to this store.`,
      `Only ask a clarifying question if it is genuinely relevant to narrowing down within THIS store's product types.`
    );

    return storeLines.join('\n') + '\n' + BASE_RULES;
  } catch (err) {
    // Store context fetch failed — fall back to generic prompt so the assistant still works
    logger.warn({ err }, 'Could not fetch store context, falling back to generic system prompt');

    return `You are a helpful AI shopping assistant.` + '\n' + BASE_RULES;
  }
}
