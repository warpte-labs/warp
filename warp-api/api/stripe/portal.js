/**
 * POST /api/stripe/portal
 * Body: { email: string }
 * → { ok, url }  Stripe Customer Portal
 */
import { appUrl, findCustomerByEmail, stripeForm } from "../../lib/stripe.js";

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
    const body = parseBody(req);
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: "Email required" }));
    }
    const customer = await findCustomerByEmail(email);
    if (!customer) {
      res.statusCode = 404;
      return res.end(
        JSON.stringify({
          ok: false,
          error: "No Stripe customer for that email. Subscribe first.",
        })
      );
    }
    const params = new URLSearchParams();
    params.append("customer", customer.id);
    params.append("return_url", `${appUrl()}/billing/portal-return`);
    const portal = await stripeForm("/billing_portal/sessions", params, "POST");
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, url: portal.url }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Portal failed";
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: msg }));
  }
}
