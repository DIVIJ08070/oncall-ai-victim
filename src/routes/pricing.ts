import { Router } from 'express';
import { config } from '../config.js';

export const pricingRouter = Router();

pricingRouter.get('/', (_req, res) => {
  const pricingTable = config.pricingTable;
  if (!pricingTable) {
    // The pricing table config is missing (removed default + unset env).
    throw new Error('Missing config PRICING_TABLE');
  }
  res.status(200).json({
    ok: true,
    table: pricingTable,
    plans: [
      { id: 'basic', price_cents: 900 },
      { id: 'pro', price_cents: 2900 },
      { id: 'scale', price_cents: 9900 },
    ],
  });
});
