/**
 * POST /api/stripe/webhook
 * Verify Stripe signature · publish Ably license events (no DB).
 */
import { verifyWebhookSignature } from "../../lib/stripe.js";
import { installChannel, publishLicense } from "../../lib/ably.js";

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
    if (type) {
      console.log(`[stripe webhook] ${type} ${event.id || ""}`);
    }

    try {
      await handleLicenseRealtime(event);
    } catch (e) {
      console.error("[stripe webhook] ably", e);
      // Still 200 so Stripe does not retry forever on Ably blips
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, received: true }));
  } catch (e) {
    console.error("[stripe webhook]", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false }));
  }
}

/**
 * Notify extension(s) via Ably when subscription state changes.
 */
async function handleLicenseRealtime(event) {
  if (!event || !event.type) return;
  const obj = (event.data && event.data.object) || {};
  const type = event.type;

  let installId = "";
  let email = "";
  let pro = false;

  if (type === "checkout.session.completed") {
    installId =
      (obj.metadata && obj.metadata.installId) ||
      obj.client_reference_id ||
      "";
    email =
      (obj.customer_details && obj.customer_details.email) ||
      obj.customer_email ||
      (obj.metadata && obj.metadata.email) ||
      "";
    // paid subscription checkout
    pro =
      obj.mode === "subscription" &&
      (obj.payment_status === "paid" ||
        obj.payment_status === "no_payment_required" ||
        obj.status === "complete");
  } else if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated"
  ) {
    installId = (obj.metadata && obj.metadata.installId) || "";
    email = (obj.metadata && obj.metadata.email) || "";
    const st = String(obj.status || "");
    pro = st === "active" || st === "trialing";
  } else if (type === "customer.subscription.deleted") {
    installId = (obj.metadata && obj.metadata.installId) || "";
    email = (obj.metadata && obj.metadata.email) || "";
    pro = false;
  } else if (type === "invoice.paid") {
    // subscription renewals — metadata often empty; skip if no install
    installId =
      (obj.subscription_details &&
        obj.subscription_details.metadata &&
        obj.subscription_details.metadata.installId) ||
      (obj.metadata && obj.metadata.installId) ||
      "";
    email = (obj.metadata && obj.metadata.email) || "";
    if (!installId) return;
    pro = true;
  } else {
    return;
  }

  const channels = [];
  const ch = installChannel(installId);
  if (ch) channels.push(ch);
  if (!channels.length) {
    console.log("[stripe webhook] no installId — skip Ably", type);
    return;
  }

  await publishLicense(channels, {
    pro: !!pro,
    email: String(email || "").toLowerCase(),
    event: type,
    at: Date.now(),
  });
}
