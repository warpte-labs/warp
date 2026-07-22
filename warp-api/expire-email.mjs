import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env.prod.local", "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
const email = (process.argv[2] || "alec.cohen97@gmail.com").toLowerCase();
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
const past = new Date(Date.now() - 60_000).toISOString();
const start = new Date(Date.now() - 8 * 864e5).toISOString();

// Expire ALL non-pro installs for this email
const r = await pool.query(
  `UPDATE warp_licenses
   SET trial_started_at = COALESCE(trial_started_at, $2::timestamptz),
       trial_ends_at = $3::timestamptz,
       status = CASE
         WHEN stripe_status IN ('active','trialing') THEN 'pro'
         ELSE 'expired'
       END,
       email = COALESCE(email, $1),
       email_normalized = COALESCE(email_normalized, $1),
       updated_at = NOW()
   WHERE email_normalized = $1
      OR install_id IN (
        SELECT install_id FROM warp_licenses
        WHERE email_normalized IS NULL AND install_id NOT LIKE 'test%'
      )
   RETURNING install_id, email_normalized, status, trial_ends_at, stripe_status`,
  [email, start, past]
);
console.log("updated rows:", JSON.stringify(r.rows, null, 2));

// Also expire specific known installs
for (const id of [
  "20fc63a7922d054107a53203872eb816",
  "cd1dd14714a854431b54fd5d8b6930b4",
]) {
  await pool.query(
    `UPDATE warp_licenses
     SET email = $2, email_normalized = $2,
         trial_ends_at = $3::timestamptz,
         trial_started_at = COALESCE(trial_started_at, $4::timestamptz),
         status = CASE WHEN stripe_status IN ('active','trialing') THEN 'pro' ELSE 'expired' END,
         updated_at = NOW()
     WHERE install_id = $1`,
    [id, email, past, start]
  );
}
const all = await pool.query(
  `SELECT install_id, email_normalized, status, trial_ends_at, stripe_status
   FROM warp_licenses WHERE email_normalized = $1 OR install_id = ANY($2)`,
  [email, ["20fc63a7922d054107a53203872eb816", "cd1dd14714a854431b54fd5d8b6930b4"]]
);
console.log("final:", JSON.stringify(all.rows, null, 2));
await pool.end();
