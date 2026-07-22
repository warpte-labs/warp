/**
 * GET /api/license?email=
 * → { ok, pro, status, email, subscriptionId?, currentPeriodEnd? }
 *
 * Source of truth: Stripe (active/trialing sub on Warp price/product).
 * No Neon / DB required.
 */
import {
  findActiveSubscription,
  findCustomerByEmail,
} from "../lib/stripe.js";

function cors(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({ ok: false, error: "Stripe not configured", pro: false })
      );
    }

    const url = new URL(req.url || "/", "http://localhost");
    // Vercel may pass query on req.query
    const email = String(
      (req.query && req.query.email) || url.searchParams.get("email") || ""
    )
      .trim()
      .toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.statusCode = 400;
      return res.end(
        JSON.stringify({ ok: false, error: "email query required", pro: false })
      );
    }

    const customer = await findCustomerByEmail(email);
    if (!customer) {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          ok: true,
          pro: false,
          status: "none",
          email,
        })
      );
    }

    const sub = await findActiveSubscription(customer.id);
    if (!sub) {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          ok: true,
          pro: false,
          status: "none",
          email,
          customerId: customer.id,
        })
      );
    }

    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        pro: true,
        status: sub.status || "active",
        email,
        customerId: customer.id,
        subscriptionId: sub.id,
        currentPeriodEnd: sub.current_period_end || null,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "License check failed";
    res.statusCode = 500;
    return res.end(
      JSON.stringify({ ok: false, error: msg, pro: false })
    );
  }
}
