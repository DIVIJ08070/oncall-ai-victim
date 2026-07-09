/**
 * OnCall AI telemetry — the vendored, self-contained integration snippet (FR-02, NFR-04).
 *
 * This is EXACTLY what `GET /api/v1/integration-snippet` advertises, inlined so the
 * victim (and any customer app) has zero `@oncall/*` dependencies. It is:
 *   - **Non-blocking:** `capture()` only enqueues in memory and returns immediately.
 *     It never awaits the network and never throws.
 *   - **Batched:** events POST to `/api/v1/ingest` in batches (timer / size / flush).
 *   - **Fail-silent (NFR-04):** transport failures are swallowed (optionally surfaced
 *     via `onError`) so the host request path is never impacted by observability. A
 *     bounded queue means a dead collector cannot leak memory (oldest dropped).
 *
 * Wire shape matches the platform `POST /api/v1/ingest` event contract (SPEC §7.1).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface OncallEventInput {
  timestamp?: number;
  service?: string;
  level: LogLevel;
  message: string;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
}

interface OncallWireEvent {
  timestamp: number;
  service: string;
  level: LogLevel;
  message: string;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
}

export interface OncallOptions {
  /** Per-customer ingest key sent as `x-ingest-key` (FR-01). */
  apiKey: string;
  /** Default service name stamped on events that omit one. */
  service: string;
  /** Ingest endpoint. Default `http://localhost:3001/api/v1/ingest`. */
  ingestUrl?: string;
  /** Flush when this many events are queued. Default 50 (server cap is 500). */
  batchSize?: number;
  /** Auto-flush cadence in ms. Default 2000. `0` disables the timer. */
  flushIntervalMs?: number;
  /** Max buffered events before the oldest are dropped. Default 10000. */
  maxQueue?: number;
  /** Per-request timeout in ms. Default 5000 (NFR-05 ≤5s ingest budget). */
  timeoutMs?: number;
  /** Optional error sink; if absent, transport errors are silently swallowed. */
  onError?: (err: unknown) => void;
}

const DEFAULTS = {
  ingestUrl: 'http://localhost:3001/api/v1/ingest',
  batchSize: 50,
  flushIntervalMs: 2000,
  maxQueue: 10000,
  timeoutMs: 5000,
};

/** Hard per-request cap enforced by the platform (`POST /ingest` ≤ 500/req). */
const MAX_EVENTS_PER_REQUEST = 500;

/** Batched, non-blocking, fail-silent log-shipping client (NFR-04). */
export class OncallClient {
  private readonly opts: Required<Omit<OncallOptions, 'onError'>> &
    Pick<OncallOptions, 'onError'>;
  private readonly queue: OncallWireEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private inflight = new Set<Promise<void>>();

  constructor(options: OncallOptions) {
    this.opts = {
      apiKey: options.apiKey,
      service: options.service,
      ingestUrl: options.ingestUrl ?? DEFAULTS.ingestUrl,
      batchSize: Math.max(1, options.batchSize ?? DEFAULTS.batchSize),
      flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      maxQueue: Math.max(1, options.maxQueue ?? DEFAULTS.maxQueue),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      onError: options.onError,
    };
    this.startTimer();
  }

  /** Enqueue an event. Synchronous, non-blocking, never throws (NFR-04). */
  capture(event: OncallEventInput): void {
    if (this.closed) return;
    try {
      this.queue.push({
        timestamp: event.timestamp ?? Date.now(),
        service: event.service ?? this.opts.service,
        level: event.level,
        message: event.message,
        stack: event.stack ?? null,
        endpoint: event.endpoint ?? null,
        method: event.method ?? null,
        status: event.status ?? null,
        latency_ms: event.latency_ms ?? null,
      });
      while (this.queue.length > this.opts.maxQueue) this.queue.shift();
      if (this.queue.length >= this.opts.batchSize) void this.flush();
    } catch (err) {
      this.reportError(err);
    }
  }

  info(message: string, fields?: Partial<OncallEventInput>): void {
    this.capture({ ...fields, level: 'info', message });
  }
  warn(message: string, fields?: Partial<OncallEventInput>): void {
    this.capture({ ...fields, level: 'warn', message });
  }
  error(message: string, fields?: Partial<OncallEventInput>): void {
    this.capture({ ...fields, level: 'error', message });
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Flush all queued events. Never throws / never rejects (fail-silent). */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batches: OncallWireEvent[][] = [];
    while (this.queue.length > 0) {
      batches.push(this.queue.splice(0, MAX_EVENTS_PER_REQUEST));
    }
    for (const batch of batches) {
      const p = this.send(batch);
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
      await p;
    }
  }

  /** Stop the timer and flush remaining events. Idempotent; never throws. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await Promise.allSettled([...this.inflight]);
  }

  private startTimer(): void {
    if (this.opts.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    this.timer.unref?.();
  }

  private async send(batch: OncallWireEvent[]): Promise<void> {
    const doFetch = globalThis.fetch;
    if (typeof doFetch !== 'function') {
      this.reportError(new Error('no fetch implementation available'));
      return;
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    to.unref?.();
    try {
      const res = await doFetch(this.opts.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingest-key': this.opts.apiKey,
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        this.reportError(new Error(`ingest responded ${res.status}`));
      }
    } catch (err) {
      // Network error, abort/timeout, JSON error — all swallowed (NFR-04).
      this.reportError(err);
    } finally {
      clearTimeout(to);
    }
  }

  private reportError(err: unknown): void {
    try {
      this.opts.onError?.(err);
    } catch {
      // An onError that itself throws must never surface.
    }
  }
}

/* ── minimal structural Express types (no hard type import) ──────────────── */
interface Req {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
}
interface Res {
  statusCode?: number;
  on(event: string, listener: () => void): unknown;
}
type Next = (err?: unknown) => void;

/** Express middleware augmented with the shared client + a paired error handler. */
export type OncallMiddleware = ((req: Req, res: Res, next: Next) => void) & {
  client: OncallClient;
  errorHandler: (err: unknown, req: Req, res: Res, next: Next) => void;
};

function endpointOf(req: Req): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function errStack(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message, stack: err.stack ?? null };
  if (typeof err === 'string') return { message: err, stack: null };
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

/**
 * Telemetry middleware — the FR-02 snippet: `app.use(oncall({ apiKey, service }))`.
 * Emits one `info` event per completed request (endpoint,method,status,latency_ms)
 * and one `error` event per thrown failure (message,stack). Register `.errorHandler`
 * last (`app.use(mw.errorHandler)`) to capture thrown errors with stacks.
 */
export function oncall(options: OncallOptions): OncallMiddleware {
  const client = new OncallClient(options);

  const requestLogger = (req: Req, res: Res, next: Next): void => {
    const start = Date.now();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      client.capture({
        level: 'info',
        message: `${req.method ?? 'GET'} ${endpointOf(req)}`,
        endpoint: endpointOf(req),
        method: req.method ?? null,
        status: res.statusCode ?? null,
        latency_ms: Date.now() - start,
      });
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };

  const errorHandler = (err: unknown, req: Req, res: Res, next: Next): void => {
    const { message, stack } = errStack(err);
    client.capture({
      level: 'error',
      message,
      stack,
      endpoint: endpointOf(req),
      method: req.method ?? null,
      status: res.statusCode && res.statusCode >= 400 ? res.statusCode : 500,
    });
    next(err);
  };

  const mw = requestLogger as OncallMiddleware;
  mw.client = client;
  mw.errorHandler = errorHandler;
  return mw;
}
