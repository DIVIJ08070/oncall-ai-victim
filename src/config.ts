/** App config. `PRICING_TABLE` has a safe default in the healthy build. */
function num(name: string, def: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : def;
}
function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? def : raw;
}

export const config = {
  port: num('PORT', num('VICTIM_PORT', 4000)),
  service: str('SERVICE_NAME', str('VICTIM_SERVICE', 'checkout-api')),
  ingestUrl: str('ONCALL_INGEST_URL', 'http://localhost:3001/api/v1/ingest'),
  apiKey: str('ONCALL_API_KEY', 'dev-local-ingest-key'),
  // Pricing table config default (present in the healthy build).
  pricingTable: process.env.PRICING_TABLE ?? 'default-pricing-v1',
};
