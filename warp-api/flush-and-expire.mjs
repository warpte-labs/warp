import fs from "fs";
import pg from "pg";
import { Redis } from "@upstash/redis";

const env = fs.readFileSync(".env.prod.local", "utf8");
function envGet(k) {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(k + "="));
  if (!line) return "";
  return line.slice(k.length + 1).trim().replace(/^["']|["']$/g, "");
}

const url = envGet("DATABASE_URL");
const redisUrl = envGet("KV_REST_API_URL") || envGet("UPSTASH_REDIS_REST_URL");
const redisToken =
  envGet("KV_REST_API_TOKEN") || envGet("UPSTASH_REDIS_REST_TOKEN");
const email = "alec.cohen97@gmail.com";

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
const past = new Date(Date.now() - 60_000).toISOString();
const start = new Date(Date.now() - 8 * 864e5).toISOString();

const r = await pool.query(
  `UPDATE warp_licenses
   SET email = $1,
       email_normalized = $1,
       trial_started_at = COALESCE(trial_started_at, $2::timestamptz),
       trial_ends_at = $3::timestamptz,
       status = CASE
         WHEN stripe_status IN ('active','trialing') THEN 'pro'
         ELSE 'expired'
       END,
       updated_at = NOW()
   RETURNING install_id, email_normalized, status, trial_ends_at, stripe_status`,
  [email, start, past]
);
console.log("neon rows:", r.rows);

if (redisUrl && redisToken) {
  const redis = new Redis({ url: redisUrl, token: redisToken });
  for (const row of r.rows) {
    const k1 = `warp:lic:install:${row.install_id}`;
    const k2 = `warp:lic:email:${email}`;
    await redis.del(k1);
    await redis.del(k2);
    console.log("redis del", k1, k2);
  }
  // also del test keys
  await redis.del("warp:lic:install:testdevice12345678");
} else {
  console.log("no redis env in .env.prod.local — pull again");
}
await pool.end();
