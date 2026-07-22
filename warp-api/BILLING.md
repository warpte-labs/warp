# Warp Pro billing (Stripe)

## Model
- **7-day free trial** — local (extension `globalState`), starts on first message
- **$5 USD / month** — Stripe Checkout subscription
- **No Neon** — Pro status is checked live via Stripe by billing email

## Env (Vercel → Project → Settings → Environment Variables)

```
STRIPE_SECRET_KEY=sk_test_...   # then sk_live_ when ready
STRIPE_PRICE_ID=price_...       # must match key mode (test vs live)
STRIPE_PRODUCT_ID=prod_...
APP_URL=https://warpte.com
STRIPE_WEBHOOK_SECRET=whsec_... # after webhook endpoint exists
ABLY_API_KEY=appId.keyId:keySecret  # realtime Pro unlock (optional but recommended)
```

## Ably (no manual Refresh)
1. Create free app at https://ably.com  
2. Copy **Root** API key → Vercel `ABLY_API_KEY`  
3. Redeploy  
4. Stripe webhook publishes to channel `warp:install:{installId}`  
5. Extension also **polls** license for 5 minutes after opening Checkout (works even without Ably)


## Test vs Live price IDs
Stripe **Test** and **Live** have different `price_` IDs.  
If checkout returns `No such price`, open Stripe **Test mode**, create the same $5/mo price, and set that `STRIPE_PRICE_ID`.

## API
| Route | Purpose |
|---|---|
| `POST /api/stripe/checkout` | `{ email, installId? }` → Checkout URL |
| `POST /api/stripe/portal` | `{ email }` → Customer Portal |
| `GET /api/license?email=` | `{ pro, status, ... }` |
| `POST /api/stripe/webhook` | Stripe events (ack only) |

## Webhook
1. Deploy site
2. Stripe Dashboard → Developers → Webhooks → Add endpoint  
   `https://warpte.com/api/stripe/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`

## Extension
Settings → Account → **Subscribe** / **Refresh** / **Manage billing**  
Setting `warp.billingApiBase` (default `https://warpte.com`)
