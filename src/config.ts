/**
 * Single source of truth for Warp settings (secure defaults).
 * Maps to package.json `warp.*` + in-app Settings categories.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const SECTION = "warp";

function grokHomeDir(): string {
  if (process.env.GROK_HOME) return process.env.GROK_HOME;
  return path.join(os.homedir(), ".grok");
}

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export type PermissionMode = "ask" | "auto" | "yolo";
export type SandboxProfile = "off" | "workspace" | "read-only" | "strict";
export type EffortLevel = "low" | "medium" | "high";

export const LIMITS = {
  maxImageBytes: 12 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxAttachCount: 12,
  maxExportChars: 2_000_000,
} as const;

// ── Permissions ──────────────────────────────────────────────

export function getPermissionMode(): PermissionMode {
  const raw = (cfg().get<string>("permissionMode", "") || "").toLowerCase();
  if (raw === "auto" || raw === "yolo" || raw === "ask") return raw;
  // Back-compat: alwaysApprove true → yolo
  return cfg().get<boolean>("alwaysApprove", false) ? "yolo" : "ask";
}

export async function setPermissionMode(mode: PermissionMode): Promise<void> {
  const m: PermissionMode =
    mode === "auto" || mode === "yolo" || mode === "ask" ? mode : "ask";
  await cfg().update("permissionMode", m, vscode.ConfigurationTarget.Global);
  // Keep alwaysApprove in sync for older code paths
  await cfg().update(
    "alwaysApprove",
    m === "yolo",
    vscode.ConfigurationTarget.Global
  );
}

/** @deprecated prefer getPermissionMode */
export function getAlwaysApprove(): boolean {
  return getPermissionMode() === "yolo";
}

/** @deprecated prefer setPermissionMode */
export async function setAlwaysApprove(on: boolean): Promise<void> {
  await setPermissionMode(on ? "yolo" : "ask");
}

// ── Models ───────────────────────────────────────────────────

export function getDefaultEffort(): EffortLevel {
  const raw = (cfg().get<string>("defaultEffort", "high") || "high").toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return "high";
}

export async function setDefaultEffort(level: EffortLevel): Promise<void> {
  await cfg().update(
    "defaultEffort",
    level,
    vscode.ConfigurationTarget.Global
  );
}

// ── Safety ───────────────────────────────────────────────────

export function getSandboxProfile(): SandboxProfile {
  const raw = (cfg().get<string>("sandboxProfile", "off") || "off").toLowerCase();
  if (
    raw === "workspace" ||
    raw === "read-only" ||
    raw === "strict" ||
    raw === "off"
  ) {
    return raw as SandboxProfile;
  }
  return "off";
}

export async function setSandboxProfile(
  profile: SandboxProfile
): Promise<void> {
  await cfg().update(
    "sandboxProfile",
    profile,
    vscode.ConfigurationTarget.Global
  );
}

// ── Transcript ───────────────────────────────────────────────

/** Read a boolean, preferring global then workspace, then default. */
function getBool(key: string, defaultValue: boolean): boolean {
  const insp = cfg().inspect<boolean>(key);
  if (typeof insp?.globalValue === "boolean") return insp.globalValue;
  if (typeof insp?.workspaceValue === "boolean") return insp.workspaceValue;
  if (typeof insp?.workspaceFolderValue === "boolean") {
    return insp.workspaceFolderValue;
  }
  const v = cfg().get<boolean>(key, defaultValue);
  return typeof v === "boolean" ? v : defaultValue;
}

/** Write global. Never throw — UI prefs still work if config write fails. */
async function setBool(key: string, on: boolean): Promise<boolean> {
  const v = !!on;
  try {
    await cfg().update(key, v, vscode.ConfigurationTarget.Global);
  } catch {
    /* ignore */
  }
  return v;
}

export function getShowThinking(): boolean {
  return getBool("showThinking", true);
}

export async function setShowThinking(on: boolean): Promise<boolean> {
  return setBool("showThinking", on);
}

export function getGroupToolRows(): boolean {
  return getBool("groupToolRows", true);
}

export async function setGroupToolRows(on: boolean): Promise<boolean> {
  return setBool("groupToolRows", on);
}

/** Follow stream to bottom while generating (default on). */
export function getScrollWithStream(): boolean {
  return getBool("scrollWithStream", true);
}

export async function setScrollWithStream(on: boolean): Promise<boolean> {
  return setBool("scrollWithStream", on);
}

// ── Session ──────────────────────────────────────────────────

/** 0 = off, 1–100 = compact when context usage ≥ this %. Default 100. */
export function getAutoCompactPercent(): number {
  const n = cfg().get<number>("autoCompactPercent", 100);
  if (typeof n !== "number" || Number.isNaN(n)) return 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export async function setAutoCompactPercent(n: number): Promise<number> {
  const v = Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
  try {
    await cfg().update(
      "autoCompactPercent",
      v,
      vscode.ConfigurationTarget.Global
    );
  } catch {
    /* ignore */
  }
  // Also write Grok's native threshold so the agent auto-compacts too
  try {
    syncGrokAutoCompactThreshold(v);
  } catch {
    /* ignore */
  }
  return v;
}

// ── Connection ───────────────────────────────────────────────

export function getBinaryPathSetting(): string {
  return (cfg().get<string>("binaryPath", "") || "").trim();
}

export async function setBinaryPath(value: string): Promise<void> {
  await cfg().update(
    "binaryPath",
    String(value || "").trim(),
    vscode.ConfigurationTarget.Global
  );
}

export function getDefaultCwdSetting(): string {
  return (cfg().get<string>("defaultCwd", "") || "").trim();
}

export async function setDefaultCwd(value: string): Promise<void> {
  await cfg().update(
    "defaultCwd",
    String(value || "").trim(),
    vscode.ConfigurationTarget.Global
  );
}

// ── Dev (not in sidebar UI) ──────────────────────────────────

export function getMockMode(): boolean {
  return cfg().get<boolean>("mockMode", false);
}

export async function setMockMode(on: boolean): Promise<void> {
  await cfg().update("mockMode", !!on, vscode.ConfigurationTarget.Global);
}

// ── Snapshot for Settings panel ──────────────────────────────

export type SettingsSnapshot = {
  permissionMode: PermissionMode;
  alwaysApprove: boolean;
  defaultEffort: EffortLevel;
  sandboxProfile: SandboxProfile;
  showThinking: boolean;
  groupToolRows: boolean;
  scrollWithStream: boolean;
  autoCompactPercent: number;
  binaryPath: string;
  defaultCwd: string;
  mockMode: boolean;
  resolvedBinary: string;
  binaryAvailable: boolean;
  signedIn: boolean;
  agentCwd: string;
  version: string;
};

/**
 * Write `[session] auto_compact_threshold_percent` into ~/.grok/config.toml
 * so Grok's own auto-compact matches Warp. 0 = off.
 */
export function syncGrokAutoCompactThreshold(percent: number): void {
  const v = Math.min(100, Math.max(0, Math.round(percent)));
  const file = path.join(grokHomeDir(), "config.toml");
  let text = "";
  try {
    if (fs.existsSync(file)) {
      text = fs.readFileSync(file, "utf8");
    }
  } catch {
    text = "";
  }

  const line = `auto_compact_threshold_percent = ${v}`;
  if (/auto_compact_threshold_percent\s*=/.test(text)) {
    text = text.replace(
      /auto_compact_threshold_percent\s*=\s*[^\r\n]*/g,
      line
    );
  } else if (/\[session\]/.test(text)) {
    text = text.replace(/\[session\][ \t]*/, `[session]\n${line}\n`);
  } else {
    text =
      (text.trimEnd() ? text.trimEnd() + "\n\n" : "") +
      `[session]\n${line}\n`;
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  } catch {
    /* ignore */
  }
}
