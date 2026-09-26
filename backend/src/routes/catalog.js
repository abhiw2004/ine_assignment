import { Router } from 'express';
import { searchProducts, getItem, getCatalog } from '../store/catalog.js';

const router = Router();

// GET /api/catalog/search?q=camera&limit=25
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const results = await searchProducts(q, { limit });
    res.json({ query: q, count: results.length, results });
  } catch (err) { next(err); }
});

// GET /api/catalog/item/:id  -> full metadata incl. options + specs
router.get('/item/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const item = await getItem(id);
    res.json(item);
  } catch (err) { next(err); }
});

// GET /api/catalog/refresh -> force reload the cached catalog
router.post('/refresh', async (req, res, next) => {
  try {
    const items = await getCatalog({ force: true });
    res.json({ count: items.length });
  } catch (err) { next(err); }
});

export default router;
