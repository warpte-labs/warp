/**
 * Neon Postgres pool (DATABASE_URL / POSTGRES_URL — pooler preferred).
 */
import pg from "pg";

const { Pool } = pg;

let pool = null;
let schemaReady = null;

export function getPool() {
  if (pool) return pool;
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!url) {
    throw new Error("DATABASE_URL not set");
  }
  pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

export function dbConfigured() {
  return !!(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL
  );
}

/** Idempotent schema for production licenses */
export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS warp_licenses (
        id BIGSERIAL PRIMARY KEY,
        install_id TEXT NOT NULL UNIQUE,
        email TEXT,
        email_normalized TEXT,
        trial_started_at TIMESTAMPTZ,
        trial_ends_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'none',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        stripe_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_warp_licenses_email
        ON warp_licenses (email_normalized);
      CREATE INDEX IF NOT EXISTS idx_warp_licenses_stripe_customer
        ON warp_licenses (stripe_customer_id);
      CREATE INDEX IF NOT EXISTS idx_warp_licenses_stripe_sub
        ON warp_licenses (stripe_subscription_id);
    `);
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}
