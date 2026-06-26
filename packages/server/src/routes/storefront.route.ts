import { Router } from 'express';

import { storefrontController } from '../controllers/storefront.controller';

const router = Router();

// Mounted at /api/storefront — the App Proxy maps the storefront path
// /apps/assistant/chat to /api/storefront/chat on this server.
router.post('/chat', storefrontController.chat);

export default router;
