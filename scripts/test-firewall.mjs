/**
 * Burst-test Vercel Firewall rules on warpte.com
 */
const BASE = "https://warpte.com";

async function hit(path, method = "GET", body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(BASE + path, opts);
    return res.status;
  } catch (e) {
    return 0;
  }
}

function hist(arr) {
  const h = {};
  for (const s of arr) h[s] = (h[s] || 0) + 1;
  return h;
}

async function burst(name, n, fn) {
  const statuses = [];
  const t0 = Date.now();
  // sequential to one IP — better for tripping per-IP limits cleanly
  for (let i = 0; i < n; i++) {
    statuses.push(await fn(i));
  }
  const ms = Date.now() - t0;
  const h = hist(statuses);
  const r429 = h[429] || 0;
  console.log(
    `${name.padEnd(28)} n=${n}  ${JSON.stringify(h)}  429=${r429}  ${ms}ms  ${r429 > 0 ? "PASS (limited)" : "NO 429 yet"}`
  );
  return h;
}

console.log("Testing firewall on", BASE);
console.log("---");

// License: limit 60/min — send 80
await burst("GET /api/license", 80, (i) =>
  hit(`/api/license?installId=fwtest${String(i).padStart(12, "0")}`)
);

// Checkout: 10/min — send 20
await burst("POST /api/stripe/checkout", 20, (i) =>
  hit("/api/stripe/checkout", "POST", {
    email: `fw${i}@example.com`,
    installId: "fwcheckout0000001",
  })
);

// Ably: 30/min — send 45
await burst("GET /api/ably/token", 45, (i) =>
  hit(`/api/ably/token?installId=fwably${String(i).padStart(10, "0")}`)
);

// Portal: 10/min — send 15
await burst("POST /api/stripe/portal", 15, (i) =>
  hit("/api/stripe/portal", "POST", { email: `nobody${i}@example.com` })
);

// Debug expire: should deny
await burst("POST /api/license/debug-expire", 5, () =>
  hit("/api/license/debug-expire", "POST", {
    installId: "fwdebug00000001",
    secret: "x",
  })
);

// Webhook: light limit 120 — just 5 should still work (or 400 sig)
await burst("POST /api/stripe/webhook", 5, () =>
  hit("/api/stripe/webhook", "POST", { type: "ping" })
);

console.log("---");
console.log("PASS = saw HTTP 429 (rate limit working)");
console.log("Debug expire: expect 403/404/deny, not 200 with ok");
