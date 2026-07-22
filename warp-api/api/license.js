/**
 * GET /api/license?installId=&email=&startTrial=1
 *
 * Production license check (Neon + Redis + Stripe).
 * Extension MUST call this before every agent turn.
 */
import { dbConfigured } from "../lib/db.js";
import { resolveLicense } from "../lib/licenseStore.js";
import { redisConfigured } from "../lib/redis.js";

function cors(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    if (!dbConfigured()) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({
          ok: false,
          allowed: false,
          error: "DATABASE_URL not configured",
        })
      );
    }

    const url = new URL(req.url || "/", "http://localhost");
    const q = req.query || {};
    const installId = String(
      q.installId || url.searchParams.get("installId") || ""
    ).trim();
    const email = String(q.email || url.searchParams.get("email") || "").trim();
    const startTrial =
      String(q.startTrial || url.searchParams.get("startTrial") || "") ===
        "1" ||
      String(q.startTrial || url.searchParams.get("startTrial") || "") ===
        "true";

    const lic = await resolveLicense({ installId, email, startTrial });

    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        ...lic,
        redis: redisConfigured(),
      })
    );
  } catch (e) {
    console.error("[license]", e);
    const status = e && e.status ? e.status : 500;
    res.statusCode = status;
    return res.end(
      JSON.stringify({
        ok: false,
        allowed: false,
        error: e instanceof Error ? e.message : "License error",
      })
    );
  }
}
