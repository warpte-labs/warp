/**
 * Live Chat History while the history panel is open.
 *
 * Local only: watches ~/.grok/sessions (summary.json / chat_history.jsonl).
 * Same product pattern as usageLive — no Ably (sessions are on disk).
 *
 * - historySubscribe: list auto-updates
 * - historyWatchDetail: open transcript re-reads when that session changes
 * - historyNudge: call after newChat / turn end so list updates even if watch is quiet
 */
import * as fs from "fs";
import * as path from "path";
import { grokHome } from "./paths";
import {
  clearSessionsLiteCache,
  listLocalSessions,
  readSessionTranscript,
} from "./sessionHistory";

export type HistoryPost = (message: unknown) => void;
export type HistoryLog = (line: string) => void;

type ListSub = {
  post: HistoryPost;
  log?: HistoryLog;
};

type DetailSub = {
  sessionId: string;
  post: HistoryPost;
  log?: HistoryLog;
};

let listSub: ListSub | null = null;
let detailSub: DetailSub | null = null;
let watchers: fs.FSWatcher[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastListFp = "";
let lastDetailFp = "";
let lastPushAt = 0;
let pushing = false;

const DEBOUNCE_MS = 500;
const POLL_MS = 5_000;
const MIN_PUSH_GAP_MS = 400;
const LIST_LIMIT = 100;

/** History panel opened (or back to list). */
export function historySubscribe(post: HistoryPost, log?: HistoryLog): void {
  listSub = { post, log };
  // List view — stop detail watch until a session is opened again
  historyUnwatchDetail();
  ensureWatchers();
  ensurePoll();
  void pushList(true, "subscribe");
}

/** History panel closed. */
export function historyUnsubscribe(): void {
  listSub = null;
  historyUnwatchDetail();
  stopWatchers();
  stopPoll();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastListFp = "";
}

/** Viewing one session transcript — re-push when its files change. */
export function historyWatchDetail(
  sessionId: string,
  post: HistoryPost,
  log?: HistoryLog
): void {
  if (!sessionId) return;
  detailSub = { sessionId, post, log };
  lastDetailFp = "";
  void pushDetail(true, "watch");
}

export function historyUnwatchDetail(): void {
  detailSub = null;
  lastDetailFp = "";
}

/** After new chat / turn / rename — soft refresh if panel is open. */
export function historyNudge(reason = "nudge"): void {
  if (!listSub && !detailSub) return;
  schedulePush(reason);
}

function ensureWatchers(): void {
  if (watchers.length) return;
  const root = path.join(grokHome(), "sessions");
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  } catch {
    /* ignore */
  }

  const onFs = () => schedulePush("fs");
  try {
    // recursive works on Windows/macOS in modern Node
    watchers.push(
      fs.watch(root, { recursive: true, persistent: false }, onFs)
    );
  } catch {
    try {
      watchers.push(fs.watch(root, { persistent: false }, onFs));
    } catch {
      /* ignore */
    }
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
  pollTimer = setInterval(() => {
    if (listSub || detailSub) schedulePush("poll");
  }, POLL_MS);
  try {
    (pollTimer as NodeJS.Timeout).unref?.();
  } catch {
    /* ignore */
  }
}

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function schedulePush(reason: string): void {
  if (!listSub && !detailSub) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushAll(false, reason);
  }, DEBOUNCE_MS);
}

async function pushAll(force: boolean, reason: string): Promise<void> {
  if (listSub) await pushList(force, reason);
  if (detailSub) await pushDetail(force, reason);
}

async function pushList(force: boolean, reason: string): Promise<void> {
  if (!listSub || pushing) return;
  const now = Date.now();
  if (!force && now - lastPushAt < MIN_PUSH_GAP_MS) return;
  pushing = true;
  const { post, log } = listSub;
  try {
    clearSessionsLiteCache();
    const t0 = Date.now();
    const sessions = listLocalSessions(LIST_LIMIT);
    const fp = listFingerprint(sessions);
    if (!force && fp === lastListFp) return;
    lastListFp = fp;
    lastPushAt = Date.now();
    log?.(
      `[history] live list ${reason} n=${sessions.length} ms=${Date.now() - t0}`
    );
    post({ type: "historyList", sessions, live: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.(`[history] live list error ${message}`);
    post({ type: "historyError", text: message });
  } finally {
    pushing = false;
  }
}

async function pushDetail(force: boolean, reason: string): Promise<void> {
  if (!detailSub) return;
  const { sessionId, post, log } = detailSub;
  try {
    const { session, messages } = readSessionTranscript(sessionId, 250);
    const fp = `${sessionId}|${messages.length}|${session?.updatedAt || ""}|${
      messages[messages.length - 1]?.text?.slice(0, 40) || ""
    }`;
    if (!force && fp === lastDetailFp) return;
    lastDetailFp = fp;
    log?.(
      `[history] live detail ${reason} ${sessionId.slice(0, 8)}… msgs=${messages.length}`
    );
    post({
      type: "historyDetail",
      session,
      messages,
      live: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.(`[history] live detail error ${message}`);
    // Don't spam errors on transient deletes
    if (force) {
      post({ type: "historyError", text: message });
    }
  }
}

function listFingerprint(
  sessions: { id: string; title: string; updatedAt: string; messageCount?: number }[]
): string {
  return sessions
    .map(
      (s) =>
        `${s.id}:${s.updatedAt}:${s.messageCount ?? 0}:${(s.title || "").slice(0, 24)}`
    )
    .join("|");
}
