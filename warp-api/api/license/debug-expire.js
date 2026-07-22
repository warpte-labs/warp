/**
 * POST /api/license/debug-expire
 * Body: { installId, secret }
 * Only when LICENSE_DEBUG_SECRET matches — force trial_ends_at to past (QA).
 */
import { dbConfigured, ensureSchema, getPool } from "../../lib/db.js";
import { cacheInvalidateLicense } from "../../lib/redis.js";
import { resolveLicense } from "../../lib/licenseStore.js";

function cors(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false }));
  }

  const secret = process.env.LICENSE_DEBUG_SECRET || "";
  if (!secret) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, error: "Not enabled" }));
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};
  if (String(body.secret || "") !== secret) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  }

  try {
    if (!dbConfigured()) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ ok: false, error: "No DB" }));
    }
    await ensureSchema();
    const installId = String(body.installId || "")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);
    if (!installId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: "installId required" }));
    }
    const p = getPool();
    const past = new Date(Date.now() - 60_000).toISOString();
    const start = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await p.query(
      `INSERT INTO warp_licenses (install_id, trial_started_at, trial_ends_at, status, updated_at)
       VALUES ($1, $2, $3, 'expired', NOW())
       ON CONFLICT (install_id) DO UPDATE SET
         trial_started_at = COALESCE(warp_licenses.trial_started_at, $2),
         trial_ends_at = $3,
         status = 'expired',
         stripe_status = CASE
           WHEN warp_licenses.stripe_status IN ('active','trialing') THEN warp_licenses.stripe_status
           ELSE 'canceled'
         END,
         updated_at = NOW()`,
      [installId, start, past]
    );
    // If they are paid Pro, don't kill Pro
    await p.query(
      `UPDATE warp_licenses SET status = 'pro', trial_ends_at = NULL
       WHERE install_id = $1 AND stripe_status IN ('active','trialing')`,
      [installId]
    );
    await cacheInvalidateLicense({ installId });
    const lic = await resolveLicense({ installId, startTrial: false });
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, license: lic }));
  } catch (e) {
    console.error("[debug-expire]", e);
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "error",
      })
    );
  }
}
