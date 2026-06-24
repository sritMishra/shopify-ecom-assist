// sync.route.ts
//
// Exposes a single endpoint to trigger the product sync manually:
//   POST /api/sync/products
//
// This is intentionally a simple, admin-only trigger.
// In production you would protect this with an API key or admin auth.
// For now it's open — fine for local development.

import { Request, Response, Router } from 'express';

import { syncAllProducts } from '../services/product-sync.service';
import logger from '../utils/logger';

const router = Router();

// POST /api/sync/products
// Triggers a full sync of all Shopify products into the vector database.
// Responds immediately with a summary once the sync completes.
router.post('/products', async (_req: Request, res: Response) => {
  try {
    const result = await syncAllProducts();

    res.json({
      success: true,
      synced: result.synced,
      failed: result.failed,
      message: `Synced ${result.synced} products. ${result.failed} failed.`,
    });
  } catch (err) {
    logger.error({ err }, 'Product sync endpoint failed');
    res.status(500).json({ success: false, message: 'Sync failed. Check server logs.' });
  }
});

export default router;
