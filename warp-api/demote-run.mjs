import fs from "fs";
import pg from "pg";
import { Redis } from "@upstash/redis";

function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v) out[m[1]] = v;
  }
  return out;
}

const env = {
  ...loadEnv(".env.prod.local"),
  ...loadEnv(".env.local"),
  ...process.env,
};

const email = (process.argv[2] || "alec.cohen97@gmail.com").toLowerCase();
const stripeKey = env.STRIPE_SECRET_KEY || "";
const dbUrl = env.DATABASE_URL || "";

console.log("stripe:", stripeKey ? stripeKey.slice(0, 8) + "…" : "MISSING");
console.log("db:", dbUrl ? "yes" : "MISSING");

if (!stripeKey.startsWith("sk_test_")) {
  console.error("Need sk_test_ key (test mode only)");
  process.exit(1);
}
if (!dbUrl) {
  console.error("Need DATABASE_URL");
  process.exit(1);
}

async function stripeForm(path, method = "GET", form = null) {
  const opts = {
    method,
    headers: { Authorization: "Bearer " + stripeKey },
  };
  if (form) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch("https://api.stripe.com/v1" + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "stripe " + res.status);
  return data;
}

const customers = await stripeForm(
  "/customers?email=" + encodeURIComponent(email) + "&limit=10"
);
console.log("customers", (customers.data || []).length);
for (const c of customers.data || []) {
  console.log(" customer", c.id);
  const subs = await stripeForm(
    "/subscriptions?customer=" + encodeURIComponent(c.id) + "&status=all&limit=20"
  );
  for (const s of subs.data || []) {
    console.log("  sub", s.id, s.status);
    if (["active", "trialing", "past_due"].includes(s.status)) {
      const canceled = await stripeForm("/subscriptions/" + s.id, "DELETE");
      console.log("  canceled →", canceled.status);
    }
  }
}

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
   WHERE email_normalized = $1 OR email = $1
   RETURNING install_id, status, stripe_status, stripe_subscription_id`,
  [email, start, past]
);
console.log("neon", r.rows);

if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
  const redis = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
  });
  await redis.del("warp:lic:email:" + email);
  for (const row of r.rows) {
    await redis.del("warp:lic:install:" + row.install_id);
    console.log("redis del", row.install_id);
  }
}

await pool.end();
console.log("DONE — expired free, not Pro");
