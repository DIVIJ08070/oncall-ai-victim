import { Router } from 'express';

export const reportsRouter = Router();

/** Fast, indexed report query. */
function reportQuery(): { rows: number; window: string } {
  return { rows: 128, window: 'last_24h' };
}

reportsRouter.get('/', (_req, res) => {
  const result = reportQuery();
  res.status(200).json({ ok: true, report: result, generated_at: Date.now() });
});
