/**
 * Ably realtime — Flows-style REST publish + TokenRequest / token mint.
 * Env: ABLY_API_KEY
 * Channel: warp:install:<installId>
 * Events:
 *   "license"  { pro, email?, event?, at }  — Pro unlock / downgrade
 *   "usage"    optional cloud usage ping (extension also watches local log)
 *   "credits"  optional credit-bar refresh trigger
 */
import Ably from "ably";

let _rest = null;
let _triedInit = false;

function apiKey() {
  return String(process.env.ABLY_API_KEY || "").trim();
}

export function ablyConfigured() {
  return apiKey().includes(":");
}

function restClient() {
  if (_rest || _triedInit) return _rest;
  _triedInit = true;
  const key = apiKey();
  if (!key) {
    console.warn("[ably] ABLY_API_KEY not set — realtime publish disabled");
    return null;
  }
  try {
    _rest = new Ably.Rest({ key });
  } catch (err) {
    console.warn("[ably] SDK init failed:", err && err.message);
    _rest = null;
  }
  return _rest;
}

export function installChannel(installId) {
  const id = String(installId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  return id ? `warp:install:${id}` : null;
}

export async function publishLicense(channels, data) {
  return publishEvent(channels, "license", data);
}

/** Publish named event (license | usage | credits) to install channel(s). */
export async function publishEvent(channels, eventName, data) {
  const rest = restClient();
  if (!rest) return { ok: false, skipped: true };
  const name = String(eventName || "message");
  const payload = { ...(data || {}), timestamp: Date.now() };
  const results = [];
  for (const ch of channels) {
    if (!ch) continue;
    try {
      await rest.channels.get(ch).publish(name, payload);
      console.log("[ably] published", name, "→", ch);
      results.push({ channel: ch, ok: true });
    } catch (err) {
      console.warn("[ably] publish failed", ch, err && err.message);
      results.push({ channel: ch, ok: false });
    }
  }
  return { ok: results.some((r) => r.ok), results };
}

/** Optional: ping clients to re-read usage/credits (no payload required). */
export async function publishUsagePing(channels, data) {
  return publishEvent(channels, "usage", data || { reason: "ping" });
}

/**
 * Mint subscribe-only credentials for one install.
 * Returns both TokenRequest (SDK) and token string (SSE).
 */
export async function createSubscribeToken(installId) {
  const key = apiKey();
  if (!key || !key.includes(":")) {
    throw new Error("ABLY_API_KEY not configured");
  }
  const ch = installChannel(installId);
  if (!ch) throw new Error("installId required");

  const rest = new Ably.Rest({ key });
  const capability = {};
  capability[ch] = ["subscribe"];
  const opts = {
    capability: JSON.stringify(capability),
    clientId: `warp:${String(installId).slice(0, 48)}`,
    ttl: 60 * 60 * 1000,
  };

  const tokenRequest = await rest.auth.createTokenRequest(opts);
  const tokenDetails = await rest.auth.requestToken(opts);

  return {
    channel: ch,
    tokenRequest,
    token: tokenDetails && tokenDetails.token ? tokenDetails.token : null,
    expires: tokenDetails && tokenDetails.expires ? tokenDetails.expires : null,
  };
}
