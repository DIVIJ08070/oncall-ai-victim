# oncall-ai-victim

A tiny Express "customer" service used to demo **OnCall AI**. It ships telemetry
(request/error logs) to the OnCall AI platform via a vendored, non-blocking,
fail-silent shipper (`src/telemetry.ts`) — the exact integration snippet the
platform advertises.

It has **three switchable failure modes**, each mapped to a real endpoint and a
real bad-deploy commit in this repo's history, so the AI can investigate the diff
and open a revert PR:

| mode           | endpoint            | symptom                                   | fix        |
| -------------- | ------------------- | ----------------------------------------- | ---------- |
| `bad_deploy`   | `POST /api/checkout`| null-ref `TypeError` → 500                | revert     |
| `slow_db`      | `GET /api/reports`  | 2–4s slow query → p95 latency breach      | revert     |
| `config_error` | `GET /api/pricing`  | "Missing config PRICING_TABLE" on a subset | revert     |

## Run

```bash
npm install
npm run build && npm start      # or: npm run dev
# server on http://localhost:4000  (VICTIM_PORT)
```

## Control plane

```bash
# Flip the active failure mode (in-memory; no redeploy):
curl -X POST localhost:4000/__control/failure-mode -H 'content-type: application/json' -d '{"mode":"bad_deploy"}'
# Inspect state + the git SHA "deployed" for the active mode:
curl localhost:4000/__control/state
```

## Env

| var                 | default                                   | purpose                                  |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `VICTIM_PORT`       | `4000`                                    | HTTP port                                |
| `VICTIM_SERVICE`    | `checkout-api`                            | service name stamped on telemetry        |
| `ONCALL_INGEST_URL` | `http://localhost:3001/api/v1/ingest`     | platform ingest endpoint                 |
| `ONCALL_API_KEY`    | `dev-local-ingest-key`                    | ingest key (`x-ingest-key`)              |
| `PRICING_TABLE`     | `default-pricing-v1`                      | pricing config (removed in bad deploy)   |

> This repository is seeded by `scripts/init-victim-repo.ts` in the OnCall AI
> monorepo. GitHub Actions (`ci.yml`, `deploy.yml`) build + test on every PR/merge.
