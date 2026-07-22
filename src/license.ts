/**
 * Warp Pro license: 7-day local trial + Stripe check + Ably realtime unlock.
 * Trial needs no server. Pro via billing API; Ably notifies after Checkout.
 */
import * as vscode from "vscode";
import * as crypto from "crypto";

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
const PRO_CACHE_MS = 60 * 60 * 1000; // 1h
const PAY_POLL_MS = 2500;
const PAY_POLL_MAX_MS = 5 * 60 * 1000; // 5 min after opening Checkout

const K = {
  trialStarted: "warp.license.trialStartedAt",
  billingEmail: "warp.license.billingEmail",
  installId: "warp.license.installId",
  proUntil: "warp.license.proCachedUntil",
  proFlag: "warp.license.proCached",
};

export type PlanKind = "trial" | "pro" | "expired" | "none";

export type LicenseStatus = {
  kind: PlanKind;
  allowed: boolean;
  label: string;
  detail: string;
  trialDaysLeft: number | null;
  trialEndsAt: number | null;
  billingEmail: string;
  pro: boolean;
};

type LicenseListener = (status: LicenseStatus) => void;

let ext: vscode.ExtensionContext | undefined;
let listeners: LicenseListener[] = [];
let ablyClient: { close: () => void } | null = null;
let payPollTimer: ReturnType<typeof setInterval> | null = null;
let payPollDeadline = 0;

export function initLicense(context: vscode.ExtensionContext): void {
  ext = context;
  ensureInstallId();
  // Sync with Stripe (clears stale Pro after cancel / retest)
  void refreshProFromServer().then(() => {
    notifyListeners();
  });
  void startAblyListener();
}

export function onLicenseChange(fn: LicenseListener): vscode.Disposable {
  listeners.push(fn);
  return new vscode.Disposable(() => {
    listeners = listeners.filter((x) => x !== fn);
  });
}

function notifyListeners(): void {
  const st = getLicenseStatusLocal();
  for (const fn of listeners) {
    try {
      fn(st);
    } catch {
      /* ignore */
    }
  }
}

function state() {
  if (!ext) {
    throw new Error("License not initialized");
  }
  return ext.globalState;
}

function ensureInstallId(): string {
  const s = state();
  let id = s.get<string>(K.installId);
  if (!id) {
    id = crypto.randomBytes(16).toString("hex");
    void s.update(K.installId, id);
  }
  return id;
}

export function getInstallId(): string {
  return ensureInstallId();
}

export function getBillingEmail(): string {
  return String(state().get<string>(K.billingEmail) || "")
    .trim()
    .toLowerCase();
}

export async function setBillingEmail(email: string): Promise<void> {
  await state().update(K.billingEmail, email.trim().toLowerCase());
}

export function billingApiBase(): string {
  const cfg = vscode.workspace
    .getConfiguration("warp")
    .get<string>("billingApiBase", "https://warpte.com");
  return String(cfg || "https://warpte.com").replace(/\/$/, "");
}

export async function markTrialStarted(): Promise<void> {
  const s = state();
  const existing = s.get<number>(K.trialStarted);
  if (typeof existing === "number" && existing > 0) return;
  await s.update(K.trialStarted, Date.now());
}

function trialStartedAt(): number | null {
  const v = state().get<number>(K.trialStarted);
  return typeof v === "number" && v > 0 ? v : null;
}

function cachedPro(): boolean {
  const s = state();
  if (!s.get<boolean>(K.proFlag)) return false;
  const until = s.get<number>(K.proUntil) || 0;
  return until > Date.now();
}

async function setProCache(pro: boolean): Promise<void> {
  const s = state();
  await s.update(K.proFlag, pro);
  await s.update(K.proUntil, pro ? Date.now() + PRO_CACHE_MS : 0);
}

/** Force-clear local Pro (e.g. retest after Stripe cancel). */
export async function clearProCache(): Promise<void> {
  await setProCache(false);
  notifyListeners();
}

export function getLicenseStatusLocal(): LicenseStatus {
  if (cachedPro()) {
    return {
      kind: "pro",
      allowed: true,
      label: "Pro",
      detail: "$5/mo · active",
      trialDaysLeft: null,
      trialEndsAt: null,
      billingEmail: getBillingEmail(),
      pro: true,
    };
  }

  const start = trialStartedAt();
  if (start == null) {
    return {
      kind: "none",
      allowed: true,
      label: "Free trial",
      detail: "7 days free · starts on first message",
      trialDaysLeft: 7,
      trialEndsAt: null,
      billingEmail: getBillingEmail(),
      pro: false,
    };
  }

  const ends = start + TRIAL_MS;
  const leftMs = ends - Date.now();
  if (leftMs > 0) {
    const days = Math.max(1, Math.ceil(leftMs / (24 * 60 * 60 * 1000)));
    return {
      kind: "trial",
      allowed: true,
      label: "Trial",
      detail: `${days} day${days === 1 ? "" : "s"} left · then $5/mo`,
      trialDaysLeft: days,
      trialEndsAt: ends,
      billingEmail: getBillingEmail(),
      pro: false,
    };
  }

  return {
    kind: "expired",
    allowed: false,
    label: "Trial ended",
    detail: "Subscribe to Warp Pro · $5/mo",
    trialDaysLeft: 0,
    trialEndsAt: ends,
    billingEmail: getBillingEmail(),
    pro: false,
  };
}

export async function refreshProFromServer(): Promise<LicenseStatus> {
  const email = getBillingEmail();
  if (!email) {
    await setProCache(false);
    return getLicenseStatusLocal();
  }
  try {
    const url = `${billingApiBase()}/api/license?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      pro?: boolean;
      error?: string;
    };
    if (data && data.pro) {
      await setProCache(true);
    } else {
      await setProCache(false);
    }
  } catch {
    /* keep cache on network error */
  }
  return getLicenseStatusLocal();
}

/**
 * Apply Pro from Ably / poll; toast once when newly activated.
 */
async function applyProUnlock(email?: string): Promise<void> {
  const wasPro = cachedPro();
  if (email) {
    await setBillingEmail(email);
  }
  await setProCache(true);
  stopPayPoll();
  notifyListeners();
  if (!wasPro) {
    void vscode.window.showInformationMessage(
      "Warp Pro is active — thank you!"
    );
  }
}

export async function assertCanUseAgent(): Promise<{
  ok: boolean;
  status: LicenseStatus;
  message?: string;
}> {
  if (cachedPro()) {
    return { ok: true, status: getLicenseStatusLocal() };
  }

  const local = getLicenseStatusLocal();
  if (!local.allowed && getBillingEmail()) {
    const refreshed = await refreshProFromServer();
    if (refreshed.allowed) {
      notifyListeners();
      return { ok: true, status: refreshed };
    }
  }

  if (local.kind === "none") {
    await markTrialStarted();
    return { ok: true, status: getLicenseStatusLocal() };
  }

  if (local.allowed) {
    return { ok: true, status: local };
  }

  return {
    ok: false,
    status: local,
    message:
      "Your 7-day Warp trial has ended. Settings → Account → Subscribe ($5/mo) to keep using Warp.",
  };
}

/** Poll Stripe license after opening Checkout (works even without Ably). */
function startPayPoll(): void {
  stopPayPoll();
  payPollDeadline = Date.now() + PAY_POLL_MAX_MS;
  payPollTimer = setInterval(() => {
    void (async () => {
      if (Date.now() > payPollDeadline) {
        stopPayPoll();
        return;
      }
      const st = await refreshProFromServer();
      if (st.pro) {
        await applyProUnlock();
      }
    })();
  }, PAY_POLL_MS);
}

function stopPayPoll(): void {
  if (payPollTimer) {
    clearInterval(payPollTimer);
    payPollTimer = null;
  }
}

/**
 * Ably realtime listener (optional — needs ABLY_API_KEY on server).
 * Falls back silently if token endpoint unavailable.
 */
async function startAblyListener(): Promise<void> {
  if (ablyClient) {
    try {
      ablyClient.close();
    } catch {
      /* ignore */
    }
    ablyClient = null;
  }

  const installId = getInstallId();
  const base = billingApiBase();

  try {
    // Dynamic import so package is optional at runtime if missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ably = require("ably") as typeof import("ably");
    const client = new Ably.Realtime({
      authCallback: (tokenParams, callback) => {
        void (async () => {
          try {
            const res = await fetch(
              `${base}/api/ably/token?installId=${encodeURIComponent(installId)}`,
              { headers: { Accept: "application/json" } }
            );
            const data = (await res.json()) as {
              ok?: boolean;
              tokenRequest?: object;
              error?: string;
            };
            if (!res.ok || !data.tokenRequest) {
              callback(data.error || `token ${res.status}`, null as never);
              return;
            }
            callback(null, data.tokenRequest as never);
          } catch (e) {
            callback(e instanceof Error ? e.message : String(e), null as never);
          }
        })();
      },
    });

    const channelName = `warp:install:${installId}`;
    const channel = client.channels.get(channelName);
    channel.subscribe("license", (msg) => {
      void (async () => {
        const data = (msg && msg.data) || {};
        const pro = !!(data as { pro?: boolean }).pro;
        const email = String((data as { email?: string }).email || "").trim();
        if (pro) {
          await applyProUnlock(email || undefined);
        } else {
          await setProCache(false);
          notifyListeners();
        }
      })();
    });

    ablyClient = {
      close: () => {
        try {
          client.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    // Ably package missing or server not configured — poll still works after Checkout
  }
}

export async function startCheckout(): Promise<void> {
  let email = getBillingEmail();
  if (!email) {
    email =
      (await vscode.window.showInputBox({
        prompt: "Email for Warp Pro billing (Stripe receipt)",
        placeHolder: "you@example.com",
        ignoreFocusOut: true,
        validateInput: (v) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim())
            ? null
            : "Enter a valid email",
      })) || "";
  }
  email = email.trim().toLowerCase();
  if (!email) {
    void vscode.window.showWarningMessage(
      "Checkout cancelled — email required."
    );
    return;
  }
  await setBillingEmail(email);

  const base = billingApiBase();
  try {
    const res = await fetch(`${base}/api/stripe/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, installId: getInstallId() }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      url?: string;
      error?: string;
    };
    if (!data.ok || !data.url) {
      throw new Error(data.error || `Checkout failed (${res.status})`);
    }
    // Listen for unlock while user pays in browser
    void startAblyListener();
    startPayPoll();
    await vscode.env.openExternal(vscode.Uri.parse(data.url));
    void vscode.window.showInformationMessage(
      "Complete payment in the browser — Warp Pro unlocks automatically."
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Warp checkout: ${msg}`);
  }
}

export async function openBillingPortal(): Promise<void> {
  let email = getBillingEmail();
  if (!email) {
    email =
      (await vscode.window.showInputBox({
        prompt: "Billing email used at checkout",
        placeHolder: "you@example.com",
        ignoreFocusOut: true,
      })) || "";
    if (email) await setBillingEmail(email);
  }
  email = email.trim().toLowerCase();
  if (!email) return;

  try {
    const res = await fetch(`${billingApiBase()}/api/stripe/portal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      url?: string;
      error?: string;
    };
    if (!data.ok || !data.url) {
      throw new Error(data.error || "Portal unavailable");
    }
    await vscode.env.openExternal(vscode.Uri.parse(data.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Warp billing: ${msg}`);
  }
}

export function licenseSettingsFields(): Record<string, unknown> {
  const st = getLicenseStatusLocal();
  return {
    planKind: st.kind,
    planLabel: st.label,
    planDetail: st.detail,
    planAllowed: st.allowed,
    planPro: st.pro,
    planTrialDaysLeft: st.trialDaysLeft,
    billingEmail: st.billingEmail,
  };
}
