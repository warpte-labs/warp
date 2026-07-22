/**
 * Minimal Stripe REST helpers (no SDK dependency).
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_PRODUCT_ID, APP_URL
 */
import crypto from "crypto";

const STRIPE = "https://api.stripe.com/v1";

function secret() {
  const k = process.env.STRIPE_SECRET_KEY || "";
  if (!k) throw new Error("STRIPE_SECRET_KEY is not set");
  return k;
}

export function priceId() {
  return process.env.STRIPE_PRICE_ID || "";
}

export function productId() {
  return process.env.STRIPE_PRODUCT_ID || "";
}

export function appUrl() {
  const u = (process.env.APP_URL || "https://warpte.com").replace(/\/$/, "");
  return u;
}

/**
 * @param {string} path e.g. "/checkout/sessions"
 * @param {Record<string, string|number|undefined>|URLSearchParams|null} form
 * @param {string} [method]
 */
export async function stripeForm(path, form, method = "POST") {
  const body =
    form instanceof URLSearchParams
      ? form
      : form
        ? new URLSearchParams(
            Object.entries(form)
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .map(([k, v]) => [k, String(v)])
          )
        : null;

  const res = await fetch(STRIPE + path, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" || method === "DELETE" ? undefined : body || undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Stripe ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.stripe = data;
    throw err;
  }
  return data;
}

/** Nested form fields for Checkout (Stripe form encoding). */
export function appendNested(params, prefix, obj) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = `${prefix}[${k}]`;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      appendNested(params, key, v);
    } else if (v !== undefined && v !== null && v !== "") {
      params.append(key, String(v));
    }
  }
}

/**
 * Find first customer by email.
 * @param {string} email
 */
export async function findCustomerByEmail(email) {
  const q = encodeURIComponent(email.trim().toLowerCase());
  const data = await stripeForm(
    `/customers?email=${q}&limit=1`,
    null,
    "GET"
  );
  const list = (data && data.data) || [];
  return list[0] || null;
}

/**
 * Active or trialing subscription for Warp Pro.
 * @param {string} customerId
 */
export async function findActiveSubscription(customerId) {
  const data = await stripeForm(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
    null,
    "GET"
  );
  const list = (data && data.data) || [];
  const price = priceId();
  const product = productId();
  for (const sub of list) {
    const st = String(sub.status || "");
    if (st !== "active" && st !== "trialing") continue;
    const items = (sub.items && sub.items.data) || [];
    for (const it of items) {
      const p = it.price || {};
      if (price && p.id === price) return sub;
      if (product && p.product === product) return sub;
    }
    // If no price/product filter configured, any active sub counts
    if (!price && !product) return sub;
  }
  return null;
}

/**
 * @param {string} rawBody
 * @param {string} sigHeader
 * @param {string} whsec
 */
export function verifyWebhookSignature(rawBody, sigHeader, whsec) {
  if (!whsec || !sigHeader) return false;
  const parts = {};
  String(sigHeader)
    .split(",")
    .forEach((p) => {
      const [k, v] = p.split("=");
      if (k && v) {
        if (!parts[k]) parts[k] = [];
        parts[k].push(v);
      }
    });
  const ts = parts.t && parts.t[0];
  const v1 = parts.v1 || [];
  if (!ts || !v1.length) return false;
  // Reject old timestamps (>5 min)
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const payload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", whsec)
    .update(payload, "utf8")
    .digest("hex");
  return v1.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(sig, "utf8")
      );
    } catch {
      return false;
    }
  });
}
