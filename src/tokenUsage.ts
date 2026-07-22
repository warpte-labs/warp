/**
 * Real token usage from Grok shell logs.
 * Source: shell.turn.inference_done in ~/.grok/logs/unified.jsonl
 *
 * Cached by mtime+size; append-only tail merge when the log grows.
 */
import * as fs from "fs";
import * as path from "path";
import { grokHome } from "./paths";

export type TokenTotals = {
  /** prompt + completion (chart / headline total) */
  totalTokens: number;
  promptTokens: number;
  cachedPromptTokens: number;
  /** max(0, prompt - cached) */
  uncachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  turns: number;
};

export type TokenUsageIndex = {
  totals: TokenTotals;
  byDay: Map<string, TokenTotals>;
  bySession: Map<string, TokenTotals>;
  latestAt: string;
  available: boolean;
};

const EMPTY: TokenTotals = {
  totalTokens: 0,
  promptTokens: 0,
  cachedPromptTokens: 0,
  uncachedPromptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  turns: 0,
};

/** Max bytes for a full rescan (log can grow large). */
const MAX_READ = 16 * 1024 * 1024;

type CacheState = {
  logPath: string;
  size: number;
  mtimeMs: number;
  index: TokenUsageIndex;
};

let cache: CacheState | null = null;

/**
 * Scan local shell log for real token events (cached).
 */
export function readTokenUsageFromLog(): TokenUsageIndex {
  const empty = emptyIndex();
  const logPath = path.join(grokHome(), "logs", "unified.jsonl");
  try {
    if (!fs.existsSync(logPath)) {
      cache = null;
      return empty;
    }
    const st = fs.statSync(logPath);
    const size = st.size;
    const mtimeMs = st.mtimeMs;
    if (size <= 0) {
      cache = null;
      return empty;
    }

    // Exact hit — log unchanged
    if (
      cache &&
      cache.logPath === logPath &&
      cache.size === size &&
      cache.mtimeMs === mtimeMs
    ) {
      return cache.index;
    }

    // Append-only growth: parse only the new tail and merge
    if (
      cache &&
      cache.logPath === logPath &&
      size > cache.size &&
      size - cache.size < MAX_READ
    ) {
      const tail = readSlice(logPath, cache.size, size - cache.size);
      if (tail !== null) {
        const delta = indexInferenceDone(tail, /*skipPartialFirst*/ true);
        if (delta.totals.turns > 0 || tail.trim().length === 0) {
          const merged = mergeIndex(cache.index, delta);
          cache = { logPath, size, mtimeMs, index: merged };
          return merged;
        }
      }
      // fall through to full rescan on weird tail
    }

    // Full (windowed) rescan
    const start = Math.max(0, size - MAX_READ);
    const text = readSlice(logPath, start, size - start);
    if (text === null) return empty;
    const index = indexInferenceDone(text, start > 0);
    cache = { logPath, size, mtimeMs, index };
    return index;
  } catch {
    return empty;
  }
}

/** Drop in-memory cache (tests / force refresh). */
export function clearTokenUsageCache(): void {
  cache = null;
}

function emptyIndex(): TokenUsageIndex {
  return {
    totals: { ...EMPTY },
    byDay: new Map(),
    bySession: new Map(),
    latestAt: "",
    available: false,
  };
}

function readSlice(
  logPath: string,
  start: number,
  len: number
): string | null {
  if (len <= 0) return "";
  try {
    const fd = fs.openSync(logPath, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function mergeIndex(base: TokenUsageIndex, delta: TokenUsageIndex): TokenUsageIndex {
  if (delta.totals.turns === 0) return base;
  const byDay = cloneMap(base.byDay);
  const bySession = cloneMap(base.bySession);
  const totals = { ...base.totals };
  addInto(totals, delta.totals);
  for (const [k, v] of delta.byDay) {
    addInto(getOrCreate(byDay, k), v);
  }
  for (const [k, v] of delta.bySession) {
    addInto(getOrCreate(bySession, k), v);
  }
  const latestAt =
    delta.latestAt &&
    (!base.latestAt || Date.parse(delta.latestAt) >= Date.parse(base.latestAt))
      ? delta.latestAt
      : base.latestAt;
  return {
    totals,
    byDay,
    bySession,
    latestAt,
    available: totals.turns > 0,
  };
}

function cloneMap(src: Map<string, TokenTotals>): Map<string, TokenTotals> {
  const m = new Map<string, TokenTotals>();
  for (const [k, v] of src) {
    m.set(k, { ...v });
  }
  return m;
}

function indexInferenceDone(
  text: string,
  skipPartialFirst: boolean
): TokenUsageIndex {
  const byDay = new Map<string, TokenTotals>();
  const bySession = new Map<string, TokenTotals>();
  const totals = { ...EMPTY };
  let latestAt = "";
  let latestMs = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.indexOf("shell.turn.inference_done") < 0) continue;
    if (skipPartialFirst && i === 0 && line[0] !== "{") continue;

    const evt = parseInferenceLine(line);
    if (!evt) continue;

    addInto(totals, evt.tokens);
    addInto(getOrCreate(byDay, evt.day), evt.tokens);
    if (evt.sessionId) {
      addInto(getOrCreate(bySession, evt.sessionId), evt.tokens);
    }
    if (evt.tsMs >= latestMs) {
      latestMs = evt.tsMs;
      latestAt = evt.ts;
    }
  }

  return {
    totals,
    byDay,
    bySession,
    latestAt,
    available: totals.turns > 0,
  };
}

type ParsedTurn = {
  ts: string;
  tsMs: number;
  day: string;
  sessionId: string;
  tokens: TokenTotals;
};

/**
 * Fast path: extract numeric fields with regex when possible to avoid
 * full JSON.parse on every matching line. Falls back to JSON.parse.
 */
function parseInferenceLine(line: string): ParsedTurn | null {
  // Cheap reject if msg field isn't the right event (other lines may contain the string)
  if (line.indexOf('"msg":"shell.turn.inference_done"') < 0) {
    // allow spaced JSON too
    if (line.indexOf("shell.turn.inference_done") < 0) return null;
  }

  const prompt = extractNum(line, "prompt_tokens");
  const cached = extractNum(line, "cached_prompt_tokens");
  const completion = extractNum(line, "completion_tokens");
  const reasoning = extractNum(line, "reasoning_tokens");
  if (prompt + completion + reasoning === 0) return null;

  const uncached = Math.max(0, prompt - cached);
  const tokens: TokenTotals = {
    totalTokens: prompt + completion,
    promptTokens: prompt,
    cachedPromptTokens: cached,
    uncachedPromptTokens: uncached,
    completionTokens: completion,
    reasoningTokens: reasoning,
    turns: 1,
  };

  const ts = extractStr(line, "ts") || "";
  const tsMs = Date.parse(ts);
  const day = Number.isFinite(tsMs)
    ? dayKeyLocal(new Date(tsMs))
    : dayKeyLocal(new Date());
  const sessionId = extractStr(line, "sid") || "";

  return {
    ts,
    tsMs: Number.isFinite(tsMs) ? tsMs : 0,
    day,
    sessionId,
    tokens,
  };
}

function extractNum(line: string, key: string): number {
  // "prompt_tokens":201479
  const re = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = line.match(re);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function extractStr(line: string, key: string): string {
  const re = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`);
  const m = line.match(re);
  return m ? m[1] : "";
}

function getOrCreate(map: Map<string, TokenTotals>, key: string): TokenTotals {
  let t = map.get(key);
  if (!t) {
    t = { ...EMPTY };
    map.set(key, t);
  }
  return t;
}

function addInto(dst: TokenTotals, src: TokenTotals): void {
  dst.totalTokens += src.totalTokens;
  dst.promptTokens += src.promptTokens;
  dst.cachedPromptTokens += src.cachedPromptTokens;
  dst.uncachedPromptTokens += src.uncachedPromptTokens;
  dst.completionTokens += src.completionTokens;
  dst.reasoningTokens += src.reasoningTokens;
  dst.turns += src.turns;
}

function dayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyTokenTotals(): TokenTotals {
  return { ...EMPTY };
}
