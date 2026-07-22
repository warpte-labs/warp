import fs from "fs";
import pg from "pg";
const env = fs.readFileSync(".env.prod.local", "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
const r = await pool.query(
  `SELECT install_id, email_normalized, status, trial_ends_at, stripe_status, updated_at
   FROM warp_licenses ORDER BY updated_at DESC LIMIT 20`
);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
