/**
 * GET /api/ably/token?installId=
 * Subscribe-only Ably token for Warp extension realtime license.
 */
import { ablyConfigured, createSubscribeToken } from "../../lib/ably.js";

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
    if (!ablyConfigured()) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({ ok: false, error: "Realtime not configured" })
      );
    }
    const url = new URL(req.url || "/", "http://localhost");
    const installId = String(
      (req.query && req.query.installId) ||
        url.searchParams.get("installId") ||
        ""
    ).trim();
    if (!installId || installId.length < 8) {
      res.statusCode = 400;
      return res.end(
        JSON.stringify({ ok: false, error: "installId required" })
      );
    }
    const out = await createSubscribeToken(installId);
    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        channel: out.channel,
        token: out.token,
        expires: out.expires,
        tokenRequest: out.tokenRequest,
      })
    );
  } catch (e) {
    console.error("[ably/token]", e);
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "Token error",
      })
    );
  }
}
