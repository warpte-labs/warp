/**
 * Warp Pro license — PRODUCTION
 *
 * Server (Neon + Redis + Stripe) is source of truth.
 * Local state is UI cache only — every send checks the server.
 */
import * as vscode from "vscode";
import * as crypto from "crypto";
import * as https from "https";
import type { IncomingMessage } from "http";

const PRO_CACHE_MS = 60_000; // short local UI cache only
const PAY_POLL_MS = 2500;
const PAY_POLL_MAX_MS = 5 * 60 * 1000;
const SOFT_SYNC_MS = 60_000;

const K = {
  billingEmail: "warp.license.billingEmail",
  installId: "warp.license.installId",
  /** last server snapshot (JSON) */
  serverSnap: "warp.license.serverSnap",
  serverSnapAt: "warp.license.serverSnapAt",
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
  source?: string;
};

type LicenseListener = (status: LicenseStatus) => void;
type AblyEventListener = (name: string, data?: unknown) => void;
type ServerSnap = {
  status: string;
  allowed: boolean;
  pro: boolean;
  label: string;
  detail: string;
  trialDaysLeft: number | null;
  trialEndsAt: number | null;
  email?: string | null;
  installId?: string;
};

let ext: vscode.ExtensionContext | undefined;
let listeners: LicenseListener[] = [];
let ablyEventListeners: AblyEventListener[] = [];
let ablyCloser: (() => void) | null = null;
let payPollTimer: ReturnType<typeof setInterval> | null = null;
let payPollDeadline = 0;
let softSyncTimer: ReturnType<typeof setInterval> | null = null;
let ablyReconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** In-flight server check de-dupe */
let inflight: Promise<LicenseStatus> | null = null;

export function initLicense(context: vscode.ExtensionContext): void {
  ext = context;
  ensureInstallId();
  context.subscriptions.push({ dispose: () => disposeLicense() });
  void fetchServerLicense({ startTrial: false }).then(() => notifyListeners());
  void startAblyListener();
  startSoftSync();
}

export function disposeLicense(): void {
  stopPayPoll();
  stopSoftSync();
  stopAbly();
}

export function onLicenseChange(fn: LicenseListener): vscode.Disposable {
  listeners.push(fn);
  return new vscode.Disposable(() => {
    listeners = listeners.filter((x) => x !== fn);
  });
}

/** Raw Ably event names (license / usage / credits) for live Usage feed. */
export function onAblyEvent(fn: AblyEventListener): vscode.Disposable {
  ablyEventListeners.push(fn);
  return new vscode.Disposable(() => {
    ablyEventListeners = ablyEventListeners.filter((x) => x !== fn);
  });
}

function emitAblyEvent(name: string, data?: unknown): void {
  for (const fn of ablyEventListeners) {
    try {
      fn(name, data);
    } catch {
      /* ignore */
    }
  }
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
  if (!ext) throw new Error("License not initialized");
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

function readSnap(): ServerSnap | null {
  const raw = state().get<string>(K.serverSnap);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServerSnap;
  } catch {
    return null;
  }
}

async function writeSnap(snap: ServerSnap): Promise<void> {
  await state().update(K.serverSnap, JSON.stringify(snap));
  await state().update(K.serverSnapAt, Date.now());
  if (snap.email) {
    await state().update(K.billingEmail, String(snap.email).toLowerCase());
  }
}

/** UI snapshot from last server response (stable labels — no "Checking…" flicker). */
export function getLicenseStatusLocal(): LicenseStatus {
  const snap = readSnap();
  const email = getBillingEmail();
  if (!snap) {
    // Stable placeholder until first server response (do not flip-flop labels)
    return {
      kind: "none",
      allowed: false,
      label: "Warp plan",
      detail: "Connecting to license server…",
      trialDaysLeft: null,
      trialEndsAt: null,
      billingEmail: email,
      pro: false,
      source: "local-empty",
    };
  }
  const kind = (snap.status || "none") as PlanKind;
  return {
    kind:
      kind === "pro" || kind === "trial" || kind === "expired" || kind === "none"
        ? kind
        : "none",
    allowed: !!snap.allowed,
    label: snap.label || "—",
    detail: snap.detail || "",
    trialDaysLeft:
      typeof snap.trialDaysLeft === "number" ? snap.trialDaysLeft : null,
    trialEndsAt:
      typeof snap.trialEndsAt === "number" ? snap.trialEndsAt : null,
    billingEmail: email || String(snap.email || ""),
    pro: !!snap.pro,
    source: "server-cache",
  };
}

/**
 * Always hits production license API (Neon/Redis/Stripe).
 */
export async function fetchServerLicense(opts?: {
  startTrial?: boolean;
}): Promise<LicenseStatus> {
  if (inflight) return inflight;
  inflight = (async () => {
    const installId = getInstallId();
    const email = getBillingEmail();
    const qs = new URLSearchParams({ installId });
    if (email) qs.set("email", email);
    if (opts?.startTrial) qs.set("startTrial", "1");
    const url = `${billingApiBase()}/api/license?${qs.toString()}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        // Fail closed for paid SaaS if server is up but errors; if network down, use short cache
        const prev = getLicenseStatusLocal();
        if (prev.source === "server-cache" && prev.allowed) {
          // allow only if we had a recent positive snap (< 2 min)
          const at = state().get<number>(K.serverSnapAt) || 0;
          if (Date.now() - at < 120_000) return prev;
        }
        return {
          kind: "expired",
          allowed: false,
          label: "Unavailable",
          detail: String(data.error || "Could not verify license"),
          trialDaysLeft: 0,
          trialEndsAt: null,
          billingEmail: email,
          pro: false,
          source: "error",
        };
      }
      const snap: ServerSnap = {
        status: String(data.status || "none"),
        allowed: !!data.allowed,
        pro: !!data.pro,
        label: String(data.label || "—"),
        detail: String(data.detail || ""),
        trialDaysLeft:
          typeof data.trialDaysLeft === "number" ? data.trialDaysLeft : null,
        trialEndsAt:
          typeof data.trialEndsAt === "number" ? data.trialEndsAt : null,
        email: data.email ? String(data.email) : email || null,
        installId,
      };
      await writeSnap(snap);
      return getLicenseStatusLocal();
    } catch {
      const prev = getLicenseStatusLocal();
      const at = state().get<number>(K.serverSnapAt) || 0;
      // Offline grace: 2 minutes only if previously allowed
      if (prev.allowed && Date.now() - at < 120_000) return prev;
      return {
        kind: "expired",
        allowed: false,
        label: "Offline",
        detail: "Cannot reach license server — try again",
        trialDaysLeft: 0,
        trialEndsAt: null,
        billingEmail: email,
        pro: false,
        source: "offline",
      };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Clear cached snap without UI thrash (no notify). */
export async function clearProCache(): Promise<void> {
  await state().update(K.serverSnap, undefined);
  await state().update(K.serverSnapAt, 0);
}

export async function refreshProFromServer(): Promise<LicenseStatus> {
  const before = JSON.stringify(readSnap());
  const st = await fetchServerLicense({ startTrial: false });
  const after = JSON.stringify(readSnap());
  // Only push UI when something actually changed
  if (before !== after) {
    notifyListeners();
  }
  return st;
}

async function applyProUnlock(email?: string): Promise<void> {
  if (email) await setBillingEmail(email);
  const was = getLicenseStatusLocal().pro;
  await fetchServerLicense({ startTrial: false });
  stopPayPoll();
  notifyListeners();
  if (!was && getLicenseStatusLocal().pro) {
    void vscode.window.showInformationMessage(
      "Warp Pro is active — thank you!"
    );
  }
}

async function applyProDowngrade(): Promise<void> {
  const was = getLicenseStatusLocal().pro;
  await fetchServerLicense({ startTrial: false });
  notifyListeners();
  if (was && !getLicenseStatusLocal().pro) {
    void vscode.window.showInformationMessage(
      "Warp Pro ended — upgrade anytime from Settings → Account & billing."
    );
  }
}

/**
 * Gate every agent send — server authoritative.
 * Starts server trial on first use only when status is still "none".
 */
export async function assertCanUseAgent(): Promise<{
  ok: boolean;
  status: LicenseStatus;
  message?: string;
}> {
  // First pass without starting trial (respect expired)
  let status = await fetchServerLicense({ startTrial: false });

  // Only start trial if never started (status none, no dates)
  if (
    status.kind === "none" &&
    !status.pro &&
    status.trialEndsAt == null
  ) {
    status = await fetchServerLicense({ startTrial: true });
  }

  notifyListeners();

  if (status.allowed) {
    return { ok: true, status };
  }

  return {
    ok: false,
    status,
    message:
      status.detail ||
      "Free trial expired. Upgrade to Pro ($5/mo) to keep chatting.",
  };
}

function startPayPoll(): void {
  stopPayPoll();
  payPollDeadline = Date.now() + PAY_POLL_MAX_MS;
  payPollTimer = setInterval(() => {
    void (async () => {
      if (Date.now() > payPollDeadline) {
        stopPayPoll();
        return;
      }
      const before = getLicenseStatusLocal().pro;
      const st = await fetchServerLicense({ startTrial: false });
      if (st.pro !== before) {
        notifyListeners();
        if (st.pro) {
          void vscode.window.showInformationMessage(
            "Warp Pro is active — thank you!"
          );
          stopPayPoll();
        }
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

function startSoftSync(): void {
  stopSoftSync();
  softSyncTimer = setInterval(() => {
    void (async () => {
      await refreshProFromServer(); // only notifies on change
      if (!ablyCloser) void startAblyListener();
    })();
  }, SOFT_SYNC_MS);
}

function stopSoftSync(): void {
  if (softSyncTimer) {
    clearInterval(softSyncTimer);
    softSyncTimer = null;
  }
}

function stopAbly(): void {
  if (ablyReconnectTimer) {
    clearTimeout(ablyReconnectTimer);
    ablyReconnectTimer = null;
  }
  if (ablyCloser) {
    try {
      ablyCloser();
    } catch {
      /* ignore */
    }
    ablyCloser = null;
  }
}

async function startAblyListener(): Promise<void> {
  stopAbly();
  const installId = getInstallId();
  const base = billingApiBase();

  let token: string;
  let channel: string;
  try {
    const res = await fetch(
      `${base}/api/ably/token?installId=${encodeURIComponent(installId)}`,
      { headers: { Accept: "application/json" } }
    );
    const data = (await res.json()) as {
      ok?: boolean;
      token?: string;
      channel?: string;
    };
    if (!res.ok || !data.token || !data.channel) return;
    token = data.token;
    channel = data.channel;
  } catch {
    return;
  }

  let closed = false;
  let req: ReturnType<typeof https.get> | null = null;
  let buffer = "";

  const scheduleReconnect = () => {
    if (closed) return;
    if (ablyReconnectTimer) clearTimeout(ablyReconnectTimer);
    ablyReconnectTimer = setTimeout(() => {
      if (!closed) void startAblyListener();
    }, 4000);
  };

  const handleNamedEvent = (name: string, raw: unknown) => {
    emitAblyEvent(name || "message", raw);
    if (name !== "license" && name !== "message" && name !== "") return;
    void (async () => {
      try {
        let data: { pro?: boolean; email?: string } = {};
        if (typeof raw === "string") {
          try {
            data = JSON.parse(raw) as { pro?: boolean; email?: string };
          } catch {
            return;
          }
        } else if (raw && typeof raw === "object") {
          data = raw as { pro?: boolean; email?: string };
        }
        if (name === "license" || typeof data.pro === "boolean") {
          if (data.email) await setBillingEmail(String(data.email));
          if (data.pro) {
            await applyProUnlock(data.email ? String(data.email) : undefined);
          } else if (data.pro === false) {
            await applyProDowngrade();
          } else {
            await refreshProFromServer();
          }
        }
      } catch {
        /* ignore */
      }
    })();
  };

  const onChunk = (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const block of parts) {
      const lines = block.split("\n");
      let eventName = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine) as {
          name?: string;
          data?: unknown;
          messages?: Array<{ name?: string; data?: unknown }>;
        };
        if (parsed.name) {
          handleNamedEvent(String(parsed.name), parsed.data);
        } else if (Array.isArray(parsed.messages)) {
          for (const m of parsed.messages) {
            handleNamedEvent(String(m.name || "message"), m.data);
          }
        } else {
          handleNamedEvent(eventName || "message", parsed.data ?? parsed);
        }
      } catch {
        /* ignore */
      }
    }
  };

  const path =
    `/event-stream?channels=${encodeURIComponent(channel)}&v=1.2` +
    `&accessToken=${encodeURIComponent(token)}`;

  req = https.get(
    {
      hostname: "realtime.ably.io",
      path,
      headers: { Accept: "text/event-stream" },
    },
    (res: IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        scheduleReconnect();
        return;
      }
      res.setEncoding("utf8");
      res.on("data", (d: string) => onChunk(d));
      res.on("end", () => {
        if (!closed) scheduleReconnect();
      });
      res.on("error", () => {
        if (!closed) scheduleReconnect();
      });
    }
  );
  req.on("error", () => {
    if (!closed) scheduleReconnect();
  });

  ablyCloser = () => {
    closed = true;
    try {
      req?.destroy();
    } catch {
      /* ignore */
    }
  };
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

  try {
    const res = await fetch(`${billingApiBase()}/api/stripe/checkout`, {
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
    void startAblyListener();
    startPayPoll();
    await vscode.env.openExternal(vscode.Uri.parse(data.url));
    void vscode.window.showInformationMessage(
      "Complete payment in the browser — Pro unlocks automatically."
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
    startPayPoll();
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

/**
 * Debug: expire trial on SERVER (Neon) if LICENSE_DEBUG_SECRET is configured,
 * then refresh local snap.
 */
export async function forceExpireTrial(): Promise<LicenseStatus> {
  const installId = getInstallId();
  const secret = vscode.workspace
    .getConfiguration("warp")
    .get<string>("licenseDebugSecret", "");
  if (secret) {
    try {
      const res = await fetch(`${billingApiBase()}/api/license/debug-expire`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ installId, secret }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `debug-expire ${res.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Server expire failed: ${msg}`);
    }
  }
  await clearProCache();
  const st = await fetchServerLicense({ startTrial: false });
  notifyListeners();
  void vscode.window.showWarningMessage(
    `License: ${st.label} · allowed=${st.allowed}. Send a message to test the lock.`
  );
  return st;
}

export async function forceResetTrial(): Promise<LicenseStatus> {
  await clearProCache();
  const st = await fetchServerLicense({ startTrial: false });
  notifyListeners();
  return st;
}
