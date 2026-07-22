import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env.prod.local");
const env = fs.readFileSync(envPath, "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
if (!m) {
  console.error("DATABASE_URL missing in .env.prod.local");
  process.exit(1);
}
const url = m[1].trim().replace(/^["']|["']$/g, "");
const installId = process.argv[2] || "cd1dd14714a854431b54fd5d8b6930b4";
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
const past = new Date(Date.now() - 60_000).toISOString();
const start = new Date(Date.now() - 8 * 864e5).toISOString();
await pool.query(
  `UPDATE warp_licenses
   SET trial_started_at = COALESCE(trial_started_at, $2::timestamptz),
       trial_ends_at = $3::timestamptz,
       status = CASE
         WHEN stripe_status IN ('active','trialing') THEN 'pro'
         ELSE 'expired'
       END,
       updated_at = NOW()
   WHERE install_id = $1`,
  [installId, start, past]
);
const r = await pool.query(
  `SELECT install_id, status, trial_ends_at, stripe_status FROM warp_licenses WHERE install_id = $1`,
  [installId]
);
console.log(r.rows[0] || "no row");
await pool.end();

