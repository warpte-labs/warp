/**
 * Local usage snapshot from ~/.grok/sessions + real tokens from unified.jsonl.
 * Chart series = real tokens (prompt + completion) from shell.turn.inference_done.
 *
 * Fast path: token log is cached; sessions use summary-only counts (no previews).
 */
import { summarizeLocalSessions } from "./sessionHistory";
import { getAuthStatus } from "./auth";
import {
  readBillingCreditsFromLog,
  type BillingCredits,
} from "./billingCredits";
import { readTokenUsageFromLog, type TokenTotals } from "./tokenUsage";

export type UsageRange = "7d" | "30d" | "90d" | "12m" | "all";

export type UsageDayRow = {
  /** YYYY-MM-DD local */
  day: string;
  /** Short label e.g. "22 Jul" */
  label: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  turns: number;
};

export type UsageSeries = {
  range: UsageRange;
  labels: string[];
  /** Real total tokens (prompt + completion) per bucket */
  values: number[];
  unit: "tokens";
};

export type UsageSnapshot = {
  signedIn: boolean;
  accountDetail: string;
  totals: {
    sessions: number;
    messages: number;
    toolCalls: number;
    contextTokensPeak: number;
    models: string[];
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    uncachedPromptTokens: number;
    inferenceTurns: number;
  };
  series: UsageSeries;
  /** Daily breakdown for the selected range (newest first) */
  daily: UsageDayRow[];
  credits: BillingCredits | null;
  note: string;
};

const RANGE_DAYS: Record<UsageRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
  all: 0,
};

export function getUsageSnapshot(
  _limit = 80,
  range: UsageRange = "30d"
): UsageSnapshot {
  const auth = getAuthStatus();
  // Parallel-ish: tokens first (often cached), then cheap session counts + credits
  const tokenIndex = readTokenUsageFromLog();
  const sessionSum = summarizeLocalSessions();
  const credits = readBillingCreditsFromLog();

  const series = buildTokenSeries(tokenIndex.byDay, range);
  const daily = buildDailyRows(tokenIndex.byDay, range);
  const tt = tokenIndex.totals;

  // Range-scoped totals for the chart period (headline uses range tokens)
  const rangeTokens = daily.reduce((a, d) => a + d.tokens, 0);
  const rangeTurns = daily.reduce((a, d) => a + d.turns, 0);
  const rangePrompt = daily.reduce((a, d) => a + d.promptTokens, 0);
  const rangeCompletion = daily.reduce((a, d) => a + d.completionTokens, 0);
  const rangeReasoning = daily.reduce((a, d) => a + d.reasoningTokens, 0);

  return {
    signedIn: auth.signedIn,
    accountDetail: auth.detail,
    totals: {
      sessions: sessionSum.sessions,
      messages: sessionSum.messages,
      toolCalls: 0,
      contextTokensPeak: 0,
      models: [],
      // Prefer range-scoped token totals so stats match the chart period
      tokens: rangeTokens || tt.totalTokens,
      promptTokens: rangePrompt || tt.promptTokens,
      completionTokens: rangeCompletion || tt.completionTokens,
      reasoningTokens: rangeReasoning || tt.reasoningTokens,
      uncachedPromptTokens: tt.uncachedPromptTokens,
      inferenceTurns: rangeTurns || tt.turns,
    },
    series,
    daily,
    credits,
    note: tokenIndex.available
      ? ""
      : "No inference_done events in local Grok log yet.",
  };
}

export function parseUsageRange(raw: unknown): UsageRange {
  const s = String(raw || "30d").toLowerCase();
  if (s === "7d" || s === "30d" || s === "90d" || s === "12m" || s === "all") {
    return s;
  }
  return "30d";
}

function rangeStartEnd(range: UsageRange): { start: Date; end: Date } {
  const now = new Date();
  const end = startOfDay(now);
  const days = RANGE_DAYS[range];
  let start: Date;
  if (days <= 0) {
    start = addMonths(end, -17);
  } else if (range === "12m") {
    start = addMonths(end, -(Math.ceil(days / 30) - 1));
  } else {
    start = addDays(end, -(days - 1));
  }
  return { start: startOfDay(start), end };
}

function buildDailyRows(
  byDay: Map<string, TokenTotals>,
  range: UsageRange
): UsageDayRow[] {
  const { start, end } = rangeStartEnd(range);
  const rows: UsageDayRow[] = [];
  for (const [day, tok] of byDay) {
    if (!tok.totalTokens && !tok.turns) continue;
    const t = Date.parse(day + "T12:00:00");
    if (!Number.isFinite(t)) continue;
    const dt = new Date(t);
    if (dt < start || dt > end) continue;
    rows.push({
      day,
      label: formatDayLabel(day),
      tokens: tok.totalTokens,
      promptTokens: tok.promptTokens,
      completionTokens: tok.completionTokens,
      reasoningTokens: tok.reasoningTokens,
      turns: tok.turns,
    });
  }
  // Newest first
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return rows;
}

function formatDayLabel(key: string): string {
  const [y, m, day] = key.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Bucket real tokens from inference_done by day / week / month.
 */
function buildTokenSeries(
  byDay: Map<string, TokenTotals>,
  range: UsageRange
): UsageSeries {
  const { start, end } = rangeStartEnd(range);
  const bucket: "day" | "week" | "month" =
    range === "90d" ? "week" : range === "12m" || range === "all" ? "month" : "day";

  const keys: string[] = [];
  const map = new Map<string, number>();

  if (bucket === "day") {
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const k = dayKey(d);
      keys.push(k);
      map.set(k, 0);
    }
  } else if (bucket === "week") {
    let d = startOfWeek(start);
    const endW = startOfWeek(end);
    while (d <= endW) {
      const k = dayKey(d);
      keys.push(k);
      map.set(k, 0);
      d = addDays(d, 7);
    }
  } else {
    let d = startOfMonth(start);
    const endM = startOfMonth(end);
    while (d <= endM) {
      const k = monthKey(d);
      keys.push(k);
      map.set(k, 0);
      d = addMonths(d, 1);
    }
  }

  for (const [day, tok] of byDay) {
    const t = Date.parse(day + "T12:00:00");
    if (!Number.isFinite(t)) continue;
    const dt = new Date(t);
    if (dt < start || dt > end) continue;
    let k: string;
    if (bucket === "day") k = dayKey(dt);
    else if (bucket === "week") k = dayKey(startOfWeek(dt));
    else k = monthKey(dt);
    if (!map.has(k)) continue;
    map.set(k, (map.get(k) || 0) + (tok.totalTokens || 0));
  }

  const labels = keys.map((k) => formatLabel(k, bucket));
  const values = keys.map((k) => map.get(k) || 0);

  return { range, labels, values, unit: "tokens" };
}

function formatLabel(key: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "month") {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  }
  const [y, m, day] = key.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
