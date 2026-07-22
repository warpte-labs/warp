/**
 * POST /api/stripe/webhook
 * Verify signature · sync Neon/Redis · Ably notify.
 */
import { verifyWebhookSignature } from "../../lib/stripe.js";
import { applyStripePro } from "../../lib/licenseStore.js";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false }));
  }

  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"] || "";
    const whsec = process.env.STRIPE_WEBHOOK_SECRET || "";

    if (whsec) {
      const ok = verifyWebhookSignature(raw, sig, whsec);
      if (!ok) {
        res.statusCode = 400;
        return res.end(
          JSON.stringify({ ok: false, error: "Invalid signature" })
        );
      }
    }

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    }

    const type = event && event.type;
    console.log(`[stripe webhook] ${type || "?"} ${event.id || ""}`);

    try {
      await handleStripeEvent(event);
    } catch (e) {
      console.error("[stripe webhook] handle", e);
      // 200 so Stripe doesn't infinite-retry on app bugs; log for ops
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, received: true }));
  } catch (e) {
    console.error("[stripe webhook]", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false }));
  }
}

async function handleStripeEvent(event) {
  if (!event || !event.type) return;
  const obj = (event.data && event.data.object) || {};
  const type = event.type;

  if (type === "checkout.session.completed") {
    const installId =
      (obj.metadata && obj.metadata.installId) ||
      obj.client_reference_id ||
      "";
    const email =
      (obj.customer_details && obj.customer_details.email) ||
      obj.customer_email ||
      (obj.metadata && obj.metadata.email) ||
      "";
    const pro =
      obj.mode === "subscription" &&
      (obj.payment_status === "paid" ||
        obj.payment_status === "no_payment_required" ||
        obj.status === "complete");
    if (!pro) return;
    await applyStripePro({
      installId,
      email,
      customerId: obj.customer || null,
      subscriptionId: obj.subscription || null,
      stripeStatus: "active",
      pro: true,
    });
    return;
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated"
  ) {
    const st = String(obj.status || "");
    const pro = st === "active" || st === "trialing";
    const installId = (obj.metadata && obj.metadata.installId) || "";
    const email = (obj.metadata && obj.metadata.email) || "";
    await applyStripePro({
      installId,
      email,
      customerId: obj.customer || null,
      subscriptionId: obj.id || null,
      stripeStatus: st,
      pro,
    });
    return;
  }

  if (type === "customer.subscription.deleted") {
    const installId = (obj.metadata && obj.metadata.installId) || "";
    const email = (obj.metadata && obj.metadata.email) || "";
    await applyStripePro({
      installId,
      email,
      customerId: obj.customer || null,
      subscriptionId: obj.id || null,
      stripeStatus: "canceled",
      pro: false,
    });
    return;
  }

  if (type === "invoice.paid") {
    const installId =
      (obj.subscription_details &&
        obj.subscription_details.metadata &&
        obj.subscription_details.metadata.installId) ||
      (obj.metadata && obj.metadata.installId) ||
      "";
    const email = (obj.metadata && obj.metadata.email) || "";
    if (!installId && !email && !obj.customer) return;
    await applyStripePro({
      installId,
      email,
      customerId: obj.customer || null,
      subscriptionId: obj.subscription || null,
      stripeStatus: "active",
      pro: true,
    });
  }
}
