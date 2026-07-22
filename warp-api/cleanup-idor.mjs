import fs from "fs";
import pg from "pg";
import { Redis } from "@upstash/redis";

const env = fs.readFileSync(".env.prod.local", "utf8");
function get(k) {
  const l = env.split(/\r?\n/).find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const pool = new pg.Pool({
  connectionString: get("DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
});

const r = await pool.query(
  `SELECT install_id, email_normalized, status, stripe_customer_id
   FROM warp_licenses
   WHERE install_id LIKE 'idor%'
      OR install_id LIKE 'farm%'
      OR install_id LIKE 'redteam%'
      OR install_id LIKE 'ratelimit%'
      OR install_id LIKE 'checkout%'
      OR install_id LIKE 'foreign%'`
);
console.log("poisoned before:", r.rows.length, r.rows.slice(0, 5));

await pool.query(
  `DELETE FROM warp_licenses
   WHERE install_id LIKE 'idor%'
      OR install_id LIKE 'farm%'
      OR install_id LIKE 'redteam%'
      OR install_id LIKE 'ratelimit%'
      OR install_id LIKE 'checkout%'
      OR install_id LIKE 'foreign%'
      OR install_id LIKE 'tokenfarm%'
      OR install_id LIKE 'bruteforce%'`
);

const redis = new Redis({
  url: get("KV_REST_API_URL"),
  token: get("KV_REST_API_TOKEN"),
});
for (const id of [
  "idordevice0000001",
  "foreigndevice0001",
  "idorfreshdevice00001",
]) {
  await redis.del("warp:lic:install:" + id);
}
await redis.del("warp:lic:email:alec.cohen97@gmail.com");
console.log("cleaned");
await pool.end();
