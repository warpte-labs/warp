/**
 * Grok account credits from shell logs (same payload as TUI /usage fetch).
 * Reads latest `billing: fetched credits config` from ~/.grok/logs/unified.jsonl.
 */
import * as fs from "fs";
import * as path from "path";
import { grokHome } from "./paths";

export type BillingCredits = {
  creditUsagePercent: number;
  periodStart: string;
  periodEnd: string;
  periodType: string;
  subscriptionTier: string;
  prepaidBalance: number;
  onDemandUsed: number;
  onDemandCap: number;
  fetchedAt: string;
};

type CreditsCache = {
  logPath: string;
  size: number;
  mtimeMs: number;
  value: BillingCredits | null;
};

let creditsCache: CreditsCache | null = null;

/**
 * Best-effort: walk unified.jsonl from the end for the newest credits config.
 * Cached by log mtime+size (same file as token usage).
 */
export function readBillingCreditsFromLog(): BillingCredits | null {
  const logPath = path.join(grokHome(), "logs", "unified.jsonl");
  try {
    if (!fs.existsSync(logPath)) {
      creditsCache = null;
      return null;
    }
    const st = fs.statSync(logPath);
    const size = st.size;
    const mtimeMs = st.mtimeMs;
    if (
      creditsCache &&
      creditsCache.logPath === logPath &&
      creditsCache.size === size &&
      creditsCache.mtimeMs === mtimeMs
    ) {
      return creditsCache.value;
    }

    // Read last ~512KB only (file can be huge)
    const max = 512 * 1024;
    let value: BillingCredits | null = null;
    const fd = fs.openSync(logPath, "r");
    try {
      const start = Math.max(0, size - max);
      const len = size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || line.indexOf("billing: fetched credits config") < 0) {
          continue;
        }
        const parsed = parseCreditsLine(line);
        if (parsed) {
          value = parsed;
          break;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    creditsCache = { logPath, size, mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}

function parseCreditsLine(line: string): BillingCredits | null {
  try {
    const row = JSON.parse(line) as {
      ts?: string;
      msg?: string;
      ctx?: {
        config?: Record<string, unknown>;
        subscriptionTier?: string;
      };
    };
    if (!row.msg || row.msg.indexOf("fetched credits") < 0) return null;
    const cfg = row.ctx?.config;
    if (!cfg || typeof cfg !== "object") return null;

    const pct = Number(cfg.creditUsagePercent);
    if (!Number.isFinite(pct)) return null;

    const period = (cfg.currentPeriod || {}) as Record<string, unknown>;
    const start = String(period.start || cfg.billingPeriodStart || "");
    const end = String(period.end || cfg.billingPeriodEnd || "");
    const periodType = String(period.type || "").replace(
      /^USAGE_PERIOD_TYPE_/,
      ""
    );

    return {
      creditUsagePercent: Math.min(100, Math.max(0, Math.round(pct))),
      periodStart: start,
      periodEnd: end,
      periodType: periodType || "",
      subscriptionTier: String(
        row.ctx?.subscriptionTier || cfg.subscriptionTier || ""
      ),
      prepaidBalance: valOf(cfg.prepaidBalance),
      onDemandUsed: valOf(cfg.onDemandUsed),
      onDemandCap: valOf(cfg.onDemandCap),
      fetchedAt: String(row.ts || ""),
    };
  } catch {
    return null;
  }
}

function valOf(v: unknown): number {
  if (v && typeof v === "object" && "val" in (v as object)) {
    const n = Number((v as { val: unknown }).val);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
