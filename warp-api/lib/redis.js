/**
 * Upstash Redis (REST) — same env names as Flows / Vercel KV.
 * Optional: if unset, license still works via Neon only.
 */
import { Redis } from "@upstash/redis";

let client = null;
let tried = false;

export function redisConfigured() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return !!(url && token);
}

export function getRedis() {
  if (tried) return client;
  tried = true;
  if (!redisConfigured()) {
    client = null;
    return null;
  }
  try {
    client = new Redis({
      url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
      token:
        process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    console.warn("[redis] init failed", e && e.message);
    client = null;
  }
  return client;
}

const TTL_SEC = 120; // short cache; webhooks invalidate immediately

export function licKeyInstall(installId) {
  return `warp:lic:install:${installId}`;
}
export function licKeyEmail(email) {
  return `warp:lic:email:${String(email || "").toLowerCase()}`;
}

export async function cacheGetLicense(installId, email) {
  const r = getRedis();
  if (!r) return null;
  try {
    // Prefer install-specific key only — never return another device's
    // payload just because the email matches.
    if (installId) {
      const v = await r.get(licKeyInstall(installId));
      if (v) {
        const parsed = typeof v === "string" ? JSON.parse(v) : v;
        if (parsed && parsed.installId && parsed.installId !== installId) {
          return null;
        }
        return parsed;
      }
      return null;
    }
    if (email) {
      const v = await r.get(licKeyEmail(email));
      if (v) return typeof v === "string" ? JSON.parse(v) : v;
    }
  } catch (e) {
    console.warn("[redis] get", e && e.message);
  }
  return null;
}

export async function cacheSetLicense(payload) {
  const r = getRedis();
  if (!r || !payload) return;
  try {
    const raw = JSON.stringify(payload);
    const ops = [];
    if (payload.installId) {
      ops.push(r.set(licKeyInstall(payload.installId), raw, { ex: TTL_SEC }));
    }
    if (payload.email) {
      ops.push(
        r.set(licKeyEmail(String(payload.email).toLowerCase()), raw, {
          ex: TTL_SEC,
        })
      );
    }
    await Promise.all(ops);
  } catch (e) {
    console.warn("[redis] set", e && e.message);
  }
}

export async function cacheInvalidateLicense({ installId, email, customerId }) {
  const r = getRedis();
  if (!r) return;
  try {
    const keys = [];
    if (installId) keys.push(licKeyInstall(installId));
    if (email) keys.push(licKeyEmail(String(email).toLowerCase()));
    if (keys.length) await r.del(...keys);
    // customer-based: optional scan not needed; keys set on next read
    void customerId;
  } catch (e) {
    console.warn("[redis] del", e && e.message);
  }
}
