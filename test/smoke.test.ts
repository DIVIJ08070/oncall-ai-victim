import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

// Liveness smoke test — passes at every commit regardless of which failure the
// deployed code carries (the failures live on the business routes, not /health).
describe('victim', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => server?.close());

  it('serves /health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});
