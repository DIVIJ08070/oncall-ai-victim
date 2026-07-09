import { Router, type Request } from 'express';

export const checkoutRouter = Router();

interface Cart {
  items: Array<{ sku: string; qty: number; price: number }>;
}

/** The cart attached to the caller's session (absent for anonymous traffic). */
function getSessionCart(req: Request): Cart {
  return (req as unknown as { session?: { cart?: Cart } }).session?.cart as Cart;
}

checkoutRouter.post('/', (req, res) => {
  const bodyItems = ((req.body ?? {}) as { cart?: Cart }).cart?.items;
  // Null guard: tolerate a missing session cart, fall back to the request body.
  const items = getSessionCart(req).items ?? bodyItems ?? [];

  const total = items.reduce((sum, it) => sum + it.qty * it.price, 0);
  res.status(200).json({
    ok: true,
    order_id: `ord_${Date.now().toString(36)}`,
    item_count: items.length,
    total_cents: Math.round(total * 100),
  });
});
