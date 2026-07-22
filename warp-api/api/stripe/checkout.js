/**
 * POST /api/stripe/checkout
 * Body: { email: string, installId?: string }
 * → { ok, url }  Stripe Checkout (subscription $5/mo)
 */
import { appUrl, priceId, productId, stripeForm } from "../../lib/stripe.js";

function cors(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body || {};
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({ ok: false, error: "Stripe not configured" })
      );
    }
    const body = parseBody(req);
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.statusCode = 400;
      return res.end(
        JSON.stringify({ ok: false, error: "Valid email required" })
      );
    }
    const installId = String(body.installId || "").slice(0, 120);
    const base = appUrl();
    const price = priceId();
    if (!price) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({
          ok: false,
          error: "STRIPE_PRICE_ID not set on server",
        })
      );
    }

    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("success_url", `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${base}/billing/cancel`);
    params.append("client_reference_id", installId || email);
    params.append("customer_email", email);
    params.append("allow_promotion_codes", "true");
    params.append("billing_address_collection", "auto");
    params.append("line_items[0][price]", price);
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[app]", "warp");
    params.append("metadata[email]", email);
    if (installId) params.append("metadata[installId]", installId);
    if (productId()) params.append("metadata[productId]", productId());
    params.append("subscription_data[metadata][app]", "warp");
    params.append("subscription_data[metadata][email]", email);
    // So subscription.* webhooks can Ably-notify this device
    if (installId) {
      params.append("subscription_data[metadata][installId]", installId);
    }

    const session = await stripeForm("/checkout/sessions", params, "POST");
    if (!session.url) {
      res.statusCode = 502;
      return res.end(
        JSON.stringify({ ok: false, error: "No checkout URL from Stripe" })
      );
    }
    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        url: session.url,
        sessionId: session.id,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    // Common: live price id with test secret key
    const hint =
      /No such price|resource_missing/i.test(msg)
        ? " Use a Price ID from the same Stripe mode as your secret key (Test vs Live)."
        : "";
    res.statusCode = e.status && e.status < 600 ? e.status : 500;
    return res.end(JSON.stringify({ ok: false, error: msg + hint }));
  }
}
