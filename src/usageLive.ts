/**
 * Live Usage feed while Settings → Usage is open.
 *
 * Tokens: watch ~/.grok/logs/unified.jsonl (local inference_done) — true realtime.
 * Ably: any install-channel event (license / usage / credits) also re-pulls snapshot
 *        so credit bars stay in sync without a Refresh button.
 *
 * No Refresh UI — same product pattern as Warp Pro + Ably.
 */
import * as fs from "fs";
import * as path from "path";
import { grokHome } from "./paths";
import { clearTokenUsageCache } from "./tokenUsage";
import { clearSessionsLiteCache } from "./sessionHistory";
import {
  getUsageSnapshot,
  parseUsageRange,
  type UsageRange,
  type UsageSnapshot,
} from "./usageStats";
import { onAblyEvent } from "./license";

export type UsagePost = (message: unknown) => void;
export type UsageLog = (line: string) => void;

type Sub = {
  range: UsageRange;
  post: UsagePost;
  log?: UsageLog;
};

let sub: Sub | null = null;
let watchers: fs.FSWatcher[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let ablyUnsub: { dispose: () => void } | null = null;
let lastPushAt = 0;
let lastFingerprint = "";
let pushing = false;

const DEBOUNCE_MS = 400;
const POLL_MS = 4_000;
const MIN_PUSH_GAP_MS = 350;

/** Webview opened Usage — start live updates for this range. */
export function usageSubscribe(
  rangeRaw: unknown,
  post: UsagePost,
  log?: UsageLog
): void {
  const range = parseUsageRange(rangeRaw);
  sub = { range, post, log };
  ensureWatchers();
  ensureAblyHook();
  ensurePoll();
  void pushSnapshot(true);
}

/** Range tab changed while still on Usage. */
export function usageSetRange(rangeRaw: unknown): void {
  if (!sub) return;
  sub.range = parseUsageRange(rangeRaw);
  void pushSnapshot(true);
}

/** Left Usage / closed Settings. */
export function usageUnsubscribe(): void {
  sub = null;
  stopWatchers();
  stopPoll();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // Keep Ably hook? Cheap — only pushes if sub is set. Dispose to avoid noise.
  if (ablyUnsub) {
    ablyUnsub.dispose();
    ablyUnsub = null;
  }
}

function ensureAblyHook(): void {
  if (ablyUnsub) return;
  ablyUnsub = onAblyEvent((name: string) => {
    if (!sub) return;
    // license / usage / credits / any install event → soft refresh
    const n = String(name || "").toLowerCase();
    if (
      !n ||
      n === "license" ||
      n === "usage" ||
      n === "credits" ||
      n === "message"
    ) {
      schedulePush("ably:" + n);
    }
  });
}

function ensureWatchers(): void {
  if (watchers.length) return;
  const logPath = path.join(grokHome(), "logs", "unified.jsonl");
  const logDir = path.dirname(logPath);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch {
    /* ignore */
  }

  const onFs = () => schedulePush("fs");
  try {
    if (fs.existsSync(logPath)) {
      watchers.push(fs.watch(logPath, { persistent: false }, onFs));
    }
  } catch {
    /* ignore */
  }
  try {
    // Catch log rotation / first create
    watchers.push(
      fs.watch(logDir, { persistent: false }, (_e, file) => {
        if (!file || String(file).includes("unified")) onFs();
      })
    );
  } catch {
    /* ignore */
  }
}

function stopWatchers(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers = [];
}

function ensurePoll(): void {
  if (pollTimer) return;
  // Backup if fs.watch is flaky on Windows
  pollTimer = setInterval(() => {
    if (sub) schedulePush("poll");
  }, POLL_MS);
  if (typeof pollTimer === "object" && "unref" in pollTimer) {
    try {
      (pollTimer as NodeJS.Timeout).unref();
    } catch {
      /* ignore */
    }
  }
}

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function schedulePush(reason: string): void {
  if (!sub) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushSnapshot(false, reason);
  }, DEBOUNCE_MS);
}

async function pushSnapshot(
  force: boolean,
  reason = "init"
): Promise<void> {
  if (!sub || pushing) return;
  const now = Date.now();
  if (!force && now - lastPushAt < MIN_PUSH_GAP_MS) return;

  pushing = true;
  const { range, post, log } = sub;
  try {
    clearTokenUsageCache();
    // Session titles change slowly — only clear on force / ably
    if (force || reason.startsWith("ably")) {
      clearSessionsLiteCache();
    }
    const t0 = Date.now();
    const snap = getUsageSnapshot(40, range);
    const fp = fingerprint(snap);
    if (!force && fp === lastFingerprint) {
      return;
    }
    lastFingerprint = fp;
    lastPushAt = Date.now();
    log?.(
      `[usage] live ${reason} range=${range} tokens=${snap.totals.tokens} ms=${Date.now() - t0}`
    );
    post({ type: "usage", live: true, ...snap });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.(`[usage] live error ${message}`);
  } finally {
    pushing = false;
  }
}

function fingerprint(snap: UsageSnapshot): string {
  const s = snap.series;
  const vals = (s?.values || []).join(",");
  const cr = snap.credits?.creditUsagePercent ?? "";
  return `${snap.totals.tokens}|${snap.totals.inferenceTurns}|${vals}|${cr}|${s?.range}`;
}
