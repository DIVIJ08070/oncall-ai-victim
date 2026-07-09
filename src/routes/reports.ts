import { Router } from 'express';

export const reportsRouter = Router();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Slow full-table-scan report query (missing index) — 2–4s. */
async function reportQuery(): Promise<{ rows: number; window: string }> {
  await sleep(2200 + Math.floor(Math.random() * 1600));
  return { rows: 128, window: 'last_24h' };
}

reportsRouter.get('/', async (_req, res) => {
  const result = await reportQuery();
  res.status(200).json({ ok: true, report: result, generated_at: Date.now() });
});
