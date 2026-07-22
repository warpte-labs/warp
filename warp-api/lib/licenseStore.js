/**
 * Production license: Neon source of truth + Redis cache + Stripe pro status.
 * Trial is SERVER-SIDE only (install_id), 7 days from first start.
 */
import { ensureSchema, getPool } from "./db.js";
import {
  cacheGetLicense,
  cacheInvalidateLicense,
  cacheSetLicense,
} from "./redis.js";
import { findActiveSubscription, findCustomerByEmail } from "./stripe.js";
import { installChannel, publishLicense } from "./ably.js";

export const TRIAL_DAYS = 7;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

export function normEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function payloadPro(row) {
  if (!row) return false;
  return (
    row.stripe_status === "active" ||
    row.stripe_status === "trialing" ||
    row.status === "pro"
  );
}

function rowToPayload(row) {
  if (!row) return null;
  const now = Date.now();
  const trialEnds = row.trial_ends_at
    ? new Date(row.trial_ends_at).getTime()
    : null;
  const trialStarted = row.trial_started_at
    ? new Date(row.trial_started_at).getTime()
    : null;

  let status = row.status || "none";
  let allowed = false;
  let label = "Free trial";
  let detail = "7 days free · starts on first message";
  let trialDaysLeft = null;
  let pro = false;

  const stripeLive =
    row.stripe_status === "active" || row.stripe_status === "trialing";

  if (stripeLive || status === "pro") {
    status = "pro";
    allowed = true;
    pro = true;
    label = "Pro";
    detail = "$5/mo · active";
  } else if (trialEnds && trialEnds > now) {
    status = "trial";
    allowed = true;
    pro = false;
    trialDaysLeft = Math.max(
      1,
      Math.ceil((trialEnds - now) / (24 * 60 * 60 * 1000))
    );
    label = "Trial";
    detail = `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left · then $5/mo`;
  } else if (trialStarted) {
    status = "expired";
    allowed = false;
    pro = false;
    trialDaysLeft = 0;
    label = "Trial ended";
    detail = "Free trial expired — upgrade to Pro ($5/mo)";
  } else {
    status = "none";
    allowed = true; // first use will start trial server-side
    pro = false;
    trialDaysLeft = TRIAL_DAYS;
    label = "Free trial";
    detail = "7 days free · starts on first message";
  }

  return {
    installId: row.install_id,
    email: row.email_normalized || row.email || null,
    status,
    allowed,
    pro,
    label,
    detail,
    trialDaysLeft,
    trialStartedAt: trialStarted,
    trialEndsAt: trialEnds,
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    stripeStatus: row.stripe_status || null,
    source: "neon",
  };
}

async function getRowByInstall(installId) {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT * FROM warp_licenses WHERE install_id = $1 LIMIT 1`,
    [installId]
  );
  return rows[0] || null;
}

async function getRowByEmail(email) {
  const e = normEmail(email);
  if (!e) return null;
  const p = getPool();
  const { rows } = await p.query(
    `SELECT * FROM warp_licenses
     WHERE email_normalized = $1
     ORDER BY
       CASE WHEN stripe_status IN ('active','trialing') THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 1`,
    [e]
  );
  return rows[0] || null;
}

async function upsertInstall(installId, patch = {}) {
  const p = getPool();
  const email = patch.email != null ? normEmail(patch.email) : null;
  await p.query(
    `INSERT INTO warp_licenses (install_id, email, email_normalized, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (install_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, warp_licenses.email),
       email_normalized = COALESCE(EXCLUDED.email_normalized, warp_licenses.email_normalized),
       updated_at = NOW()`,
    [installId, email || null, email || null]
  );
  if (Object.keys(patch).length) {
    const sets = [];
    const vals = [installId];
    let i = 2;
    const map = {
      trial_started_at: "trialStartedAt",
      trial_ends_at: "trialEndsAt",
      status: "status",
      stripe_customer_id: "stripeCustomerId",
      stripe_subscription_id: "stripeSubscriptionId",
      stripe_status: "stripeStatus",
    };
    // direct SQL fields from patch
    if (patch.trialStartedAt) {
      sets.push(`trial_started_at = $${i++}`);
      vals.push(new Date(patch.trialStartedAt).toISOString());
    }
    if (patch.trialEndsAt) {
      sets.push(`trial_ends_at = $${i++}`);
      vals.push(new Date(patch.trialEndsAt).toISOString());
    }
    if (patch.status) {
      sets.push(`status = $${i++}`);
      vals.push(patch.status);
    }
    if (patch.stripeCustomerId !== undefined) {
      sets.push(`stripe_customer_id = $${i++}`);
      vals.push(patch.stripeCustomerId);
    }
    if (patch.stripeSubscriptionId !== undefined) {
      sets.push(`stripe_subscription_id = $${i++}`);
      vals.push(patch.stripeSubscriptionId);
    }
    if (patch.stripeStatus !== undefined) {
      sets.push(`stripe_status = $${i++}`);
      vals.push(patch.stripeStatus);
    }
    if (email) {
      sets.push(`email = $${i++}`);
      vals.push(email);
      sets.push(`email_normalized = $${i++}`);
      vals.push(email);
    }
    if (sets.length) {
      sets.push(`updated_at = NOW()`);
      await p.query(
        `UPDATE warp_licenses SET ${sets.join(", ")} WHERE install_id = $1`,
        vals
      );
    }
  }
  return getRowByInstall(installId);
}

/**
 * Resolve license for install (+ optional email). Server is source of truth.
 * @param {{ installId: string, email?: string, startTrial?: boolean }} opts
 */
export async function resolveLicense(opts) {
  const installId = String(opts.installId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  if (!installId || installId.length < 8) {
    const err = new Error("installId required");
    err.status = 400;
    throw err;
  }
  const email = normEmail(opts.email);
  const startTrial = !!opts.startTrial;

  await ensureSchema();

  // 1) Redis
  const cached = await cacheGetLicense(installId, email);
  if (cached && !startTrial) {
    // Recompute allowed from timestamps in case TTL outlived trial end
    if (cached.trialEndsAt && cached.trialEndsAt <= Date.now() && !cached.pro) {
      cached.status = "expired";
      cached.allowed = false;
      cached.label = "Trial ended";
      cached.detail = "Free trial expired — upgrade to Pro ($5/mo)";
      cached.trialDaysLeft = 0;
    }
    cached.source = "redis";
    return cached;
  }

  // 2) Neon row for install
  let row = await getRowByInstall(installId);
  if (!row) {
    row = await upsertInstall(installId, { email: email || undefined });
  } else if (email && !row.email_normalized) {
    row = await upsertInstall(installId, { email });
  }

  // 3) NEVER grant Pro from client-supplied email alone (IDOR).
  //    Pro is only trusted from THIS install's Neon stripe_* fields
  //    (written by Stripe webhooks with installId metadata), or refreshed
  //    when this install is already bound to that email by a prior webhook.
  if (
    email &&
    process.env.STRIPE_SECRET_KEY &&
    row.email_normalized &&
    row.email_normalized === email &&
    row.stripe_customer_id
  ) {
    try {
      const sub = await findActiveSubscription(row.stripe_customer_id);
      if (sub) {
        row = await upsertInstall(installId, {
          email,
          status: "pro",
          stripeCustomerId: row.stripe_customer_id,
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status || "active",
        });
      } else if (row.stripe_status === "active" || row.stripe_status === "trialing") {
        // Sub no longer active — drop pro on this install
        row = await upsertInstall(installId, {
          email,
          status: "expired",
          stripeCustomerId: row.stripe_customer_id,
          stripeSubscriptionId: row.stripe_subscription_id,
          stripeStatus: "canceled",
        });
      }
    } catch (e) {
      console.warn("[license] stripe refresh", e && e.message);
    }
  }

  // 4) Trial farm: if this email already used a trial elsewhere, do not mint
  //    a new free trial on a new installId. Do NOT copy Pro from client email.
  if (email && !payloadPro(row)) {
    const byEmail = await getRowByEmail(email);
    if (byEmail && byEmail.install_id !== installId) {
      const emailPayload = rowToPayload(byEmail);
      if (
        emailPayload &&
        !emailPayload.pro &&
        (emailPayload.status === "expired" || emailPayload.trialStartedAt)
      ) {
        row = await upsertInstall(installId, {
          email,
          status: "expired",
          trialStartedAt: emailPayload.trialStartedAt || undefined,
          trialEndsAt: emailPayload.trialEndsAt || Date.now() - 1000,
        });
      }
    }
  }

  // 5) Start trial (server-side, once per identity — never if already started/expired)
  let payload = rowToPayload(row);
  if (
    startTrial &&
    payload &&
    !payload.pro &&
    !payload.trialStartedAt &&
    payload.status === "none"
  ) {
    const start = Date.now();
    const end = start + TRIAL_MS;
    row = await upsertInstall(installId, {
      email: email || undefined,
      status: "trial",
      trialStartedAt: start,
      trialEndsAt: end,
    });
    payload = rowToPayload(row);
  }

  // 6) Expire status if past trial
  if (payload && payload.status === "expired" && row.status !== "expired") {
    await upsertInstall(installId, { status: "expired" });
  }

  // Always invalidate then set so we never serve a stale "trial" after expire
  await cacheInvalidateLicense({
    installId,
    email: email || payload?.email,
  });
  if (payload) {
    await cacheSetLicense(payload);
  }
  return payload;
}

/**
 * Apply Stripe subscription state (webhook).
 */
export async function applyStripePro({
  installId,
  email,
  customerId,
  subscriptionId,
  stripeStatus,
  pro,
}) {
  await ensureSchema();
  const e = normEmail(email);
  let id = installId
    ? String(installId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
    : "";

  // Find install by metadata or by email
  if (!id && e) {
    const row = await getRowByEmail(e);
    if (row) id = row.install_id;
  }
  if (!id && customerId) {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT install_id FROM warp_licenses WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    if (rows[0]) id = rows[0].install_id;
  }
  if (!id) {
    // Create a synthetic install from customer for email-based Pro
    id = `stripe_${String(customerId || subscriptionId || Date.now()).slice(0, 40)}`;
  }

  const row = await upsertInstall(id, {
    email: e || undefined,
    status: pro ? "pro" : "expired",
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscriptionId || null,
    stripeStatus: stripeStatus || (pro ? "active" : "canceled"),
  });

  // Propagate Pro/cancel to ALL installs bound to this email (multi-device,
  // only from trusted webhook — never from client query params).
  if (e) {
    const p = getPool();
    await p.query(
      `UPDATE warp_licenses SET
         status = $2,
         stripe_customer_id = COALESCE($3, stripe_customer_id),
         stripe_subscription_id = COALESCE($4, stripe_subscription_id),
         stripe_status = $5,
         email = COALESCE(email, $1),
         email_normalized = COALESCE(email_normalized, $1),
         updated_at = NOW()
       WHERE email_normalized = $1`,
      [
        e,
        pro ? "pro" : "expired",
        customerId || null,
        subscriptionId || null,
        stripeStatus || (pro ? "active" : "canceled"),
      ]
    );
  }

  const payload = rowToPayload(await getRowByInstall(id));
  await cacheInvalidateLicense({
    installId: id,
    email: e,
    customerId,
  });
  if (payload) await cacheSetLicense(payload);

  // Ably notify this install + any other installs for email (best-effort)
  const channels = [];
  const ch = installChannel(id);
  if (ch) channels.push(ch);
  if (e) {
    try {
      const p = getPool();
      const { rows } = await p.query(
        `SELECT install_id FROM warp_licenses WHERE email_normalized = $1`,
        [e]
      );
      for (const r of rows) {
        const c = installChannel(r.install_id);
        if (c && !channels.includes(c)) channels.push(c);
      }
    } catch {
      /* ignore */
    }
  }
  if (channels.length) {
    await publishLicense(channels, {
      pro: !!pro,
      email: e || "",
      event: pro ? "pro.active" : "pro.ended",
      at: Date.now(),
    });
  }

  return payload;
}
