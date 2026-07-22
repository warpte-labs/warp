# Warp Pro — production license (Neon + Redis + Stripe + Ably)

## Architecture (paid SaaS)

| Layer | Role |
|---|---|
| **Stripe** | Money, subscriptions, portal |
| **Neon** (`warp_licenses`) | Source of truth for trial + stripe ids |
| **Redis / Upstash** | 120s cache of license snapshot (optional but recommended) |
| **Ably** | Push plan changes to extension (no Refresh) |
| **Extension** | **Every send** calls `GET /api/license` — never trusts local trial alone |

## Env (Vercel project `warp`)

### Required
```
DATABASE_URL=...              # Neon pooler (already on project)
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_PRODUCT_ID=
STRIPE_WEBHOOK_SECRET=
ABLY_API_KEY=
APP_URL=https://warpte.com
```

### Recommended (Redis)
Link **Vercel KV** or **Upstash Redis** to the warp project:
```
KV_REST_API_URL=
KV_REST_API_TOKEN=
# or
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```
Without Redis, Neon alone still works (slightly more DB load).

## Trial rules
- 7 days from **first** `startTrial=1` for that `install_id` (server clock)
- Stored as `trial_started_at` / `trial_ends_at` in Neon
- Clearing local extension storage does **not** reset trial for same installId
- New machine = new installId = new trial (optional harden: bind trial to email after first identity)

## API
| Route | Purpose |
|---|---|
| `GET /api/license?installId=&email=&startTrial=1` | Resolve allow/deny |
| `POST /api/stripe/webhook` | Sync Pro / cancel → Neon + Redis + Ably |
| `POST /api/stripe/checkout` | Checkout (metadata installId + email) |
| `POST /api/stripe/portal` | Customer portal |
| `GET /api/ably/token?installId=` | Realtime token |

## Deploy
```bash
cd warp-api
npm install
vercel --prod
```
