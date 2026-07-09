import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { config } from './config.js';
import { oncall } from './telemetry.js';
import { checkoutRouter } from './routes/checkout.js';
import { reportsRouter } from './routes/reports.js';
import { pricingRouter } from './routes/pricing.js';

/** Assemble the Express app (exported for tests). */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const telemetry = oncall({
    apiKey: config.apiKey,
    service: config.service,
    ingestUrl: config.ingestUrl,
  });
  app.use(telemetry);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: config.service });
  });

  app.use('/api/checkout', checkoutRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/pricing', pricingRouter);

  app.use(telemetry.errorHandler);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) return;
    res.status(500).json({ error: { code: 'internal', message } });
  });

  return app;
}

function isMain(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('server.ts') || entry.endsWith('server.js');
}

if (isMain()) {
  createApp().listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[victim] ${config.service} listening on :${config.port}`);
  });
}
