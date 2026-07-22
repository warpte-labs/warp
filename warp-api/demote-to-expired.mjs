/**
 * Demote a user to free trial expired (test mode).
 * - Cancels active Stripe test subscriptions for email
 * - Marks Neon rows expired / clears stripe active status
 * - Flushes Redis license keys
 *
 * Usage: node demote-to-expired.mjs alec.cohen97@gmail.com
 */
import fs from "fs";
import pg from "pg";
import { Redis } from "@upstash/redis";

const env = fs.readFileSync(".env.prod.local", "utf8");
function get(k) {
  const l = env.split(/\r?\n/).find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const email = (process.argv[2] || "alec.cohen97@gmail.com").toLowerCase();
const stripeKey = get("STRIPE_SECRET_KEY");
const dbUrl = get("DATABASE_URL");
const redisUrl = get("KV_REST_API_URL");
const redisToken = get("KV_REST_API_TOKEN");

if (!stripeKey || !dbUrl) {
  console.error("Missing STRIPE_SECRET_KEY or DATABASE_URL in .env.prod.local");
  process.exit(1);
}
if (!stripeKey.startsWith("sk_test_")) {
  console.error("Refusing: STRIPE_SECRET_KEY is not sk_test_ (won't cancel live subs)");
  process.exit(1);
}

async function stripeForm(path, method = "GET", form = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${stripeKey}` },
  };
  if (form) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch("https://api.stripe.com/v1" + path, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe ${res.status}`);
  }
  return data;
}

// 1) Cancel Stripe test subs for this email
const customers = await stripeForm(
  `/customers?email=${encodeURIComponent(email)}&limit=10`
);
console.log("Stripe customers:", (customers.data || []).length);
for (const c of customers.data || []) {
  const subs = await stripeForm(
    `/subscriptions?customer=${encodeURIComponent(c.id)}&status=all&limit=20`
  );
  for (const s of subs.data || []) {
    if (s.status === "active" || s.status === "trialing" || s.status === "past_due") {
      const canceled = await stripeForm(`/subscriptions/${s.id}`, "DELETE");
      console.log("canceled sub", s.id, "→", canceled.status);
    } else {
      console.log("skip sub", s.id, s.status);
    }
  }
}

// 2) Neon → expired for all installs with this email
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
const past = new Date(Date.now() - 60_000).toISOString();
const start = new Date(Date.now() - 8 * 864e5).toISOString();
const r = await pool.query(
  `UPDATE warp_licenses
   SET status = 'expired',
       stripe_status = 'canceled',
       trial_started_at = COALESCE(trial_started_at, $2::timestamptz),
       trial_ends_at = $3::timestamptz,
       email = COALESCE(email, $1),
       email_normalized = COALESCE(email_normalized, $1),
       updated_at = NOW()
   WHERE email_normalized = $1
      OR email = $1
   RETURNING install_id, email_normalized, status, stripe_status, stripe_subscription_id`,
  [email, start, past]
);
console.log("Neon updated:", r.rows);

// 3) Redis flush
if (redisUrl && redisToken) {
  const redis = new Redis({ url: redisUrl, token: redisToken });
  await redis.del(`warp:lic:email:${email}`);
  for (const row of r.rows) {
    await redis.del(`warp:lic:install:${row.install_id}`);
    console.log("redis del install", row.install_id);
  }
}
await pool.end();
console.log("Done — user should be free trial expired (allowed=false).");
