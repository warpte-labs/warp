/**
 * Ably REST helpers — realtime Pro unlock after Stripe checkout.
 * Env: ABLY_API_KEY  (appId.keyId:keySecret)
 */

function apiKey() {
  return String(process.env.ABLY_API_KEY || "").trim();
}

export function ablyConfigured() {
  return apiKey().includes(":");
}

/** Channel for a device install (extension globalState installId). */
export function installChannel(installId) {
  const id = String(installId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  return id ? `warp:install:${id}` : null;
}

/**
 * Publish a license update to one or more channels.
 * @param {string[]} channels
 * @param {object} data
 */
export async function publishLicense(channels, data) {
  if (!ablyConfigured()) {
    console.log("[ably] skip publish — ABLY_API_KEY not set");
    return { ok: false, skipped: true };
  }
  const key = apiKey();
  const auth = Buffer.from(key).toString("base64");
  const body = JSON.stringify({
    name: "license",
    data: data || {},
  });
  const results = [];
  for (const ch of channels) {
    if (!ch) continue;
    const url = `https://rest.ably.io/channels/${encodeURIComponent(ch)}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
      const text = await res.text();
      results.push({ channel: ch, status: res.status, ok: res.ok, body: text.slice(0, 200) });
      if (!res.ok) {
        console.error("[ably] publish failed", ch, res.status, text.slice(0, 200));
      } else {
        console.log("[ably] published", ch);
      }
    } catch (e) {
      console.error("[ably] publish error", ch, e);
      results.push({ channel: ch, ok: false, error: String(e) });
    }
  }
  return { ok: results.some((r) => r.ok), results };
}

/**
 * Create a subscribe-only token request for an install channel.
 * @param {string} installId
 */
export async function createSubscribeToken(installId) {
  if (!ablyConfigured()) {
    throw new Error("ABLY_API_KEY not configured");
  }
  const ch = installChannel(installId);
  if (!ch) throw new Error("installId required");

  const key = apiKey();
  const auth = Buffer.from(key).toString("base64");
  // keyName is the part before :
  const keyName = key.split(":")[0];
  const capability = JSON.stringify({ [ch]: ["subscribe", "presence"] });
  const ttl = 60 * 60 * 1000; // 1h

  const res = await fetch(
    `https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requestToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        capability,
        clientId: String(installId).slice(0, 64),
        ttl,
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data && data.error && data.error.message) ||
        data.message ||
        `Ably token ${res.status}`
    );
  }
  return { tokenRequest: data, channel: ch };
}
