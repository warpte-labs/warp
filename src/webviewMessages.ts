/**
 * Incoming webview → host message router.
 * Keeps WarpViewProvider thin.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { AgentProcess } from "./agentProcess";
import type { PromptAttachment } from "./acp/promptContent";
import { appendMentionRefs } from "./acp/promptContent";
import {
  listLocalSessions,
  readSessionTranscript,
  renameSession,
} from "./sessionHistory";
import { getUsageSnapshot, parseUsageRange } from "./usageStats";
import { listWorkspaceFiles } from "./workspaceFiles";
import { resolveSafePath } from "./security/paths";
import {
  LIMITS,
  type EffortLevel,
  type PermissionMode,
  type SandboxProfile,
  getAutoCompactPercent,
  getBinaryPathSetting,
  getDefaultCwdSetting,
  getDefaultEffort,
  getGroupToolRows,
  getMockMode,
  getPermissionMode,
  getSandboxProfile,
  getScrollWithStream,
  getShowThinking,
  setAutoCompactPercent,
  setBinaryPath,
  setDefaultCwd,
  setDefaultEffort,
  setGroupToolRows,
  setMockMode,
  setSandboxProfile,
  setScrollWithStream,
  setShowThinking,
} from "./config";
import { errMsg } from "./util";
import { getAuthStatus } from "./auth";
import {
  binaryLooksAvailable,
  resolveBinary,
  workspaceCwd,
} from "./paths";
import {
  assertCanUseAgent,
  clearProCache,
  getLicenseStatusLocal,
  licenseSettingsFields,
  onLicenseChange,
  openBillingPortal,
  refreshProFromServer,
  startCheckout,
} from "./license";

/** Push plan fields into settings when Ably/poll unlocks Pro. */
let licenseUiWired = false;
function ensureLicenseUiBridge(ctx: MessageContext): void {
  if (licenseUiWired) return;
  licenseUiWired = true;
  onLicenseChange(() => {
    postSettings(ctx);
  });
}

export type PostFn = (message: unknown) => void;
export type LogFn = (line: string) => void;
export type UiCommandFn = (cmd: string) => void | Promise<void>;

export type MessageContext = {
  agent: AgentProcess;
  post: PostFn;
  log?: LogFn;
  uiCommand?: UiCommandFn;
  pushAuthStatus: () => void;
};

export async function handleWebviewMessage(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const type = String(msg.type || "");
  switch (type) {
    case "ready":
      ensureLicenseUiBridge(ctx);
      ctx.pushAuthStatus();
      postPermissionMode(ctx);
      // Seed settings snapshot (transcript prefs apply without opening panel)
      postSettings(ctx);
      // Warm session so model list + effort options appear without first prompt
      void warmModels(ctx);
      return;
    case "signIn":
      await ctx.uiCommand?.("signIn");
      return;
    case "signOut":
      await ctx.uiCommand?.("signOut");
      return;
    case "prompt":
      await handlePrompt(msg, ctx);
      return;
    case "newChat":
      await handleNewChat(ctx);
      return;
    case "listFiles":
      await handleListFiles(msg, ctx);
      return;
    case "listHistory":
      handleListHistory(ctx);
      return;
    case "getHistory":
      handleGetHistory(msg, ctx);
      return;
    case "getUsage":
      handleGetUsage(msg, ctx);
      return;
    case "setModel":
      await handleSetModel(msg, ctx);
      return;
    case "openFile":
      await handleOpenFile(msg, ctx);
      return;
    case "attachFromPaths":
      await handleAttachFromPaths(msg, ctx);
      return;
    case "compact":
      await handleCompact(msg, ctx);
      return;
    case "setAlwaysApprove":
      await handleSetAlwaysApprove(msg, ctx);
      return;
    case "setPermissionMode":
      await handleSetPermissionMode(msg, ctx);
      return;
    case "copyText":
      await handleCopyText(msg, ctx);
      return;
    case "exportChat":
      await handleExportChat(msg, ctx);
      return;
    case "renameSession":
      await handleRenameSession(msg, ctx);
      return;
    case "getSettings":
      postSettings(ctx);
      return;
    case "syncPlan":
      // Account screen opened — drop stale Pro cache and re-check Stripe
      await clearProCache();
      await refreshProFromServer();
      postSettings(ctx);
      return;
    case "updateSetting":
      await handleUpdateSetting(msg, ctx);
      return;
    case "settingsAction":
      await handleSettingsAction(msg, ctx);
      return;
    default:
      return;
  }
}

function postPermissionMode(ctx: MessageContext): void {
  const mode = ctx.agent.getPermissionMode();
  ctx.post({
    type: "permissionMode",
    permissionMode: mode,
    alwaysApprove: mode === "yolo",
  });
}

function postSettings(
  ctx: MessageContext,
  overrides: Record<string, unknown> = {}
): void {
  const auth = getAuthStatus();
  const resolved = resolveBinary();
  let version = "";
  try {
    // out/webviewMessages.js → ../package.json
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { version?: string };
    version = String(pkg.version || "");
  } catch {
    version = "";
  }
  const mode =
    (overrides.permissionMode as PermissionMode | undefined) ||
    ctx.agent.getPermissionMode();
  // Prefer explicit overrides so false booleans never get re-read as default true
  const showThinking =
    typeof overrides.showThinking === "boolean"
      ? overrides.showThinking
      : getShowThinking();
  const groupToolRows =
    typeof overrides.groupToolRows === "boolean"
      ? overrides.groupToolRows
      : getGroupToolRows();
  const scrollWithStream =
    typeof overrides.scrollWithStream === "boolean"
      ? overrides.scrollWithStream
      : getScrollWithStream();
  ctx.post({
    type: "settings",
    permissionMode: mode,
    alwaysApprove: mode === "yolo",
    defaultEffort:
      (overrides.defaultEffort as string | undefined) || getDefaultEffort(),
    sandboxProfile:
      (overrides.sandboxProfile as string | undefined) || getSandboxProfile(),
    showThinking,
    groupToolRows,
    scrollWithStream,
    autoCompactPercent:
      typeof overrides.autoCompactPercent === "number"
        ? overrides.autoCompactPercent
        : getAutoCompactPercent(),
    binaryPath:
      typeof overrides.binaryPath === "string"
        ? overrides.binaryPath
        : getBinaryPathSetting(),
    defaultCwd:
      typeof overrides.defaultCwd === "string"
        ? overrides.defaultCwd
        : getDefaultCwdSetting(),
    mockMode:
      typeof overrides.mockMode === "boolean"
        ? overrides.mockMode
        : getMockMode(),
    resolvedBinary: resolved,
    binaryAvailable: binaryLooksAvailable(resolved),
    signedIn: auth.signedIn,
    agentCwd: workspaceCwd(),
    version,
    ...licenseSettingsFields(),
  });
}

async function handleUpdateSetting(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const key = typeof msg.key === "string" ? msg.key : "";
  /** Values we just wrote — always echo these so UI Off sticks */
  const overrides: Record<string, unknown> = {};
  try {
    if (key === "binaryPath") {
      await setBinaryPath(String(msg.value ?? ""));
      overrides.binaryPath = String(msg.value ?? "").trim();
      ctx.post({ type: "toast", text: "Binary path saved" });
    } else if (key === "defaultCwd") {
      await setDefaultCwd(String(msg.value ?? ""));
      overrides.defaultCwd = String(msg.value ?? "").trim();
      ctx.post({ type: "toast", text: "Default cwd saved" });
    } else if (key === "permissionMode") {
      const raw = String(msg.value ?? "ask").toLowerCase();
      const mode: PermissionMode =
        raw === "auto" || raw === "yolo" || raw === "ask" ? raw : "ask";
      const next = await ctx.agent.setPermissionMode(mode);
      overrides.permissionMode = next;
      postPermissionMode(ctx);
      ctx.post({
        type: "toast",
        text:
          next === "yolo"
            ? "Yolo on"
            : next === "auto"
              ? "Auto mode on"
              : "Ask mode on",
      });
    } else if (key === "alwaysApprove") {
      const next = await ctx.agent.setAlwaysApprove(!!msg.value);
      overrides.permissionMode = next ? "yolo" : "ask";
      postPermissionMode(ctx);
      ctx.post({
        type: "toast",
        text: next ? "Yolo on" : "Ask mode on",
      });
    } else if (key === "defaultEffort") {
      const raw = String(msg.value ?? "high").toLowerCase();
      const level: EffortLevel =
        raw === "low" || raw === "medium" || raw === "high" ? raw : "high";
      await setDefaultEffort(level);
      overrides.defaultEffort = level;
      ctx.post({ type: "toast", text: `Default effort → ${level}` });
    } else if (key === "sandboxProfile") {
      const raw = String(msg.value ?? "off").toLowerCase();
      const profile: SandboxProfile =
        raw === "workspace" ||
        raw === "read-only" ||
        raw === "strict" ||
        raw === "off"
          ? raw
          : "off";
      await setSandboxProfile(profile);
      overrides.sandboxProfile = profile;
      ctx.post({ type: "toast", text: `Sandbox → ${profile}` });
    } else if (key === "showThinking") {
      // Toast is client-side (settings toggles)
      overrides.showThinking = await setShowThinking(coerceBool(msg.value, true));
    } else if (key === "groupToolRows") {
      overrides.groupToolRows = await setGroupToolRows(
        coerceBool(msg.value, true)
      );
    } else if (key === "scrollWithStream") {
      overrides.scrollWithStream = await setScrollWithStream(
        coerceBool(msg.value, true)
      );
    } else if (key === "autoCompactPercent") {
      const v = await setAutoCompactPercent(Number(msg.value));
      overrides.autoCompactPercent = v;
      // Toast only when client asks (slider change end) — avoid spam on drag
      if (msg.toast !== false) {
        ctx.post({
          type: "toast",
          text:
            v <= 0
              ? "Auto-compact off"
              : `Auto-compact at ${v}%`,
        });
      }
    } else if (key === "mockMode") {
      const on = coerceBool(msg.value, false);
      await setMockMode(on);
      overrides.mockMode = on;
      ctx.post({
        type: "toast",
        text: on ? "Mock mode on" : "Mock mode off",
      });
    } else {
      ctx.post({ type: "toast", text: "Unknown setting" });
      return;
    }
  } catch (err) {
    ctx.post({ type: "error", text: errMsg(err) });
  }
  postSettings(ctx, overrides);
}

async function handleSettingsAction(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const action = typeof msg.action === "string" ? msg.action : "";
  try {
    if (action === "signIn") {
      await ctx.uiCommand?.("signIn");
      return;
    }
    if (action === "signOut") {
      await ctx.uiCommand?.("signOut");
      return;
    }
    if (action === "subscribe") {
      await startCheckout();
      postSettings(ctx);
      return;
    }
    if (action === "refreshPlan") {
      ctx.post({ type: "toast", text: "Checking subscription…" });
      // Drop local cache so cancel / retest is visible immediately
      await clearProCache();
      await refreshProFromServer();
      const st = getLicenseStatusLocal();
      ctx.post({
        type: "toast",
        text: st.pro
          ? "Warp Pro active — thank you!"
          : st.kind === "trial"
            ? `Trial: ${st.detail}`
            : st.kind === "none"
              ? "No Pro yet — trial starts on first message"
              : "No active subscription for that email yet.",
      });
      postSettings(ctx);
      return;
    }
    if (action === "manageBilling") {
      await openBillingPortal();
      return;
    }
    // Preferred path is webview onRunSlash → composer.runSlash("/mcps"|…).
    // Host fallback if client couldn't close settings / run slash itself.
    const slashFallback: Record<string, string> = {
      openMcps: "/mcps",
      openSkills: "/skills",
      openPlugins: "/plugins",
    };
    if (slashFallback[action]) {
      if (!requireSignedIn(ctx)) return;
      ctx.post({ type: "closeSettings" });
      ctx.post({ type: "runSlash", text: slashFallback[action] });
      return;
    }
    ctx.post({ type: "toast", text: "Unknown action" });
  } catch (err) {
    ctx.post({ type: "error", text: errMsg(err) });
  }
}

/** Coerce webview values — booleans can arrive as real bools or "true"/"false". */
function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value == null) return fallback;
  return !!value;
}

async function handlePrompt(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  if (!requireSignedIn(ctx)) return;

  const gate = await assertCanUseAgent();
  if (!gate.ok) {
    ctx.post({
      type: "error",
      text:
        gate.message ||
        "Trial ended. Open Settings → Account to subscribe ($5/mo).",
    });
    ctx.post({ type: "license", ...gate.status });
    ctx.post({ type: "turn", phase: "end" });
    return;
  }

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const attachments = (Array.isArray(msg.attachments)
    ? msg.attachments
    : []) as PromptAttachment[];
  const mentions = Array.isArray(msg.mentions) ? msg.mentions : [];
  const promptText = appendMentionRefs(text, mentions);

  if (!promptText && !attachments.length) {
    return;
  }
  try {
    await ctx.agent.sendPrompt(promptText, attachments);
  } catch (err) {
    ctx.post({ type: "error", text: errMsg(err) });
    ctx.post({ type: "turn", phase: "end" });
  }
}

function requireSignedIn(ctx: MessageContext): boolean {
  if (getAuthStatus().signedIn) return true;
  ctx.post({
    type: "error",
    text: "Not signed in. Use Continue with Grok first.",
  });
  return false;
}

async function handleNewChat(ctx: MessageContext): Promise<void> {
  try {
    const sessionId = await ctx.agent.newChat();
    ctx.log?.(
      `[chat] newChat ${sessionId ? sessionId.slice(0, 8) + "…" : "(ui only)"}`
    );
    ctx.post({ type: "chatCleared", sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[chat] newChat error ${message}`);
    ctx.post({ type: "error", text: message });
    ctx.post({ type: "chatCleared", sessionId: null });
  }
}

async function handleListFiles(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  try {
    const q = typeof msg.query === "string" ? msg.query : "";
    const files = await listWorkspaceFiles(q, 60);
    ctx.post({ type: "fileList", files, query: q });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[files] list error ${message}`);
    ctx.post({ type: "fileList", files: [], query: "" });
  }
}

function handleListHistory(ctx: MessageContext): void {
  try {
    const sessions = listLocalSessions(100);
    ctx.log?.(`[history] listed ${sessions.length} sessions`);
    ctx.post({ type: "historyList", sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[history] list error ${message}`);
    ctx.post({ type: "historyError", text: message });
  }
}

function handleGetUsage(
  msg: Record<string, unknown>,
  ctx: MessageContext
): void {
  const range = parseUsageRange(msg.range);
  try {
    const t0 = Date.now();
    const snap = getUsageSnapshot(80, range);
    ctx.log?.(
      `[usage] range=${range} sessions=${snap.totals.sessions} tokens=${snap.totals.tokens} days=${snap.daily.length} ms=${Date.now() - t0}`
    );
    ctx.post({ type: "usage", ...snap });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[usage] error ${message}`);
    ctx.post({
      type: "usage",
      signedIn: false,
      accountDetail: message,
      totals: {
        sessions: 0,
        messages: 0,
        toolCalls: 0,
        contextTokensPeak: 0,
        models: [],
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        uncachedPromptTokens: 0,
        inferenceTurns: 0,
      },
      series: { range, labels: [], values: [], unit: "tokens" },
      daily: [],
      sessions: [],
      credits: null,
      note: "",
    });
  }
}

function handleGetHistory(
  msg: Record<string, unknown>,
  ctx: MessageContext
): void {
  if (typeof msg.sessionId !== "string") {
    return;
  }
  try {
    const { session, messages } = readSessionTranscript(msg.sessionId, 250);
    ctx.log?.(
      `[history] detail ${msg.sessionId.slice(0, 8)}… msgs=${messages.length}`
    );
    ctx.post({ type: "historyDetail", session, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[history] detail error ${message}`);
    ctx.post({ type: "historyError", text: message });
  }
}

async function warmModels(ctx: MessageContext): Promise<void> {
  try {
    await ctx.agent.ensureStarted();
    const models = ctx.agent.getModelState();
    if (models.availableModels.length || models.currentModelId) {
      ctx.post({ type: "models", ...models });
    }
    ctx.post({ type: "context", ...ctx.agent.getContextUsage() });
    postPermissionMode(ctx);
    const cmds = ctx.agent.getAvailableCommands();
    if (cmds.length) {
      ctx.post({ type: "commands", commands: cmds });
    }
  } catch {
    // Not signed in / binary missing — meta stays default until auth
  }
}

async function handleAttachFromPaths(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const paths = Array.isArray(msg.paths)
    ? msg.paths.filter((p): p is string => typeof p === "string" && !!p.trim())
    : [];
  if (!paths.length) return;

  const fs = await import("fs/promises");
  const pathMod = await import("path");
  const items: Array<{
    name: string;
    mime: string;
    size: number;
    isImage: boolean;
    dataBase64?: string;
    text?: string;
  }> = [];

  for (const raw of paths.slice(0, LIMITS.maxAttachCount)) {
    try {
      // User may drop files from anywhere on disk — allow absolute outside workspace
      const filePath = resolveSafePath(raw, {
        mustBeUnderWorkspace: false,
        allowAbsoluteOutside: true,
      });
      if (!filePath) continue;
      const st = await fs.stat(filePath);
      if (!st.isFile()) continue;
      const name = pathMod.basename(filePath);
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic)$/i.test(
        name
      );
      const buf = await fs.readFile(filePath);
      const mime = isImage
        ? mimeFromName(name)
        : "application/octet-stream";
      if (isImage) {
        if (buf.length > LIMITS.maxImageBytes) continue;
        items.push({
          name,
          mime,
          size: buf.length,
          isImage: true,
          dataBase64: buf.toString("base64"),
        });
      } else if (isTextName(name) && buf.length <= LIMITS.maxFileBytes) {
        items.push({
          name,
          mime: "text/plain",
          size: buf.length,
          isImage: false,
          text: buf.toString("utf8"),
        });
      } else if (buf.length <= LIMITS.maxFileBytes) {
        items.push({
          name,
          mime,
          size: buf.length,
          isImage: false,
          dataBase64: buf.toString("base64"),
        });
      }
    } catch (err) {
      ctx.log?.(`[attach] path error ${errMsg(err)}`);
    }
  }

  if (items.length) {
    ctx.post({ type: "attachments", items });
  }
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    avif: "image/avif",
  };
  return map[ext] || "application/octet-stream";
}

function isTextName(name: string): boolean {
  return /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yml|yaml|csv|rs|py|go|java|c|cpp|h|hpp|toml|ini|log|sh|ps1|env)$/i.test(
    name
  );
}

async function handleOpenFile(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const raw =
    typeof msg.path === "string"
      ? msg.path
      : typeof msg.file === "string"
        ? msg.file
        : "";
  if (!raw.trim()) return;

  try {
    // Prefer workspace-relative; allow absolute paths that still resolve safely
    let filePath = resolveSafePath(raw, { mustBeUnderWorkspace: true });
    if (!filePath) {
      // Absolute path outside workspace — still allow open in editor (read-only UX)
      filePath = resolveSafePath(raw, { mustBeUnderWorkspace: false });
    }
    if (!filePath) {
      ctx.post({ type: "error", text: "Could not open file: invalid path" });
      return;
    }
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
    ctx.log?.(`[files] open ${filePath}`);
  } catch (err) {
    const message = errMsg(err);
    ctx.log?.(`[files] open error ${message}`);
    ctx.post({ type: "error", text: `Could not open file: ${message}` });
  }
}

async function handleCompact(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  if (!requireSignedIn(ctx)) return;
  const hint = typeof msg.hint === "string" ? msg.hint : undefined;
  try {
    ctx.log?.(`[compact] start${hint ? " " + hint : ""}`);
    await ctx.agent.compact(hint);
  } catch (err) {
    const message = errMsg(err);
    ctx.log?.(`[compact] error ${message}`);
    ctx.post({ type: "compact", phase: "error", error: message });
    ctx.post({ type: "error", text: message });
  }
}

async function handleSetAlwaysApprove(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const on =
    typeof msg.on === "boolean"
      ? msg.on
      : typeof msg.value === "boolean"
        ? msg.value
        : !ctx.agent.getAlwaysApprove();
  try {
    const next = await ctx.agent.setAlwaysApprove(on);
    postPermissionMode(ctx);
    ctx.post({
      type: "toast",
      text: next
        ? "Yolo on (tools auto-allowed)"
        : "Ask mode (tools may prompt)",
    });
    ctx.log?.(`[perm] mode=${ctx.agent.getPermissionMode()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.post({ type: "error", text: message });
  }
}

async function handleSetPermissionMode(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const raw =
    typeof msg.mode === "string"
      ? msg.mode
      : typeof msg.value === "string"
        ? msg.value
        : "";
  const mode: PermissionMode =
    raw === "auto" || raw === "yolo" || raw === "ask"
      ? raw
      : getPermissionMode();
  try {
    const next = await ctx.agent.setPermissionMode(mode);
    postPermissionMode(ctx);
    ctx.post({
      type: "toast",
      text:
        next === "yolo"
          ? "Yolo on (tools auto-allowed)"
          : next === "auto"
            ? "Auto mode (safe tools only)"
            : "Ask mode (tools may prompt)",
    });
    ctx.log?.(`[perm] mode=${next}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.post({ type: "error", text: message });
  }
}

async function handleCopyText(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const text = typeof msg.text === "string" ? msg.text : "";
  if (!text.trim()) {
    ctx.post({ type: "toast", text: "Nothing to copy" });
    return;
  }
  try {
    await vscode.env.clipboard.writeText(text);
    ctx.post({ type: "toast", text: "Copied to clipboard" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.post({ type: "error", text: `Copy failed: ${message}` });
  }
}

async function handleExportChat(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  let text = typeof msg.text === "string" ? msg.text : "";
  if (!text.trim()) {
    ctx.post({ type: "toast", text: "Nothing to export" });
    return;
  }
  if (text.length > LIMITS.maxExportChars) {
    text = text.slice(0, LIMITS.maxExportChars) + "\n\n…(truncated)…\n";
  }
  try {
    const uri = await vscode.window.showSaveDialog({
      filters: { Markdown: ["md"], Text: ["txt"] },
      saveLabel: "Export chat",
      defaultUri: vscode.Uri.file(
        path.join(workspaceCwd(), `warp-chat-${Date.now()}.md`)
      ),
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
    ctx.post({ type: "toast", text: `Exported ${path.basename(uri.fsPath)}` });
    ctx.log?.(`[export] ${uri.fsPath}`);
  } catch (err) {
    ctx.post({ type: "error", text: `Export failed: ${errMsg(err)}` });
  }
}

async function handleRenameSession(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  let title = typeof msg.title === "string" ? msg.title.trim() : "";
  let sessionId =
    typeof msg.sessionId === "string" ? msg.sessionId.trim() : "";
  if (!sessionId) {
    sessionId = ctx.agent.getSessionId() || "";
  }
  if (!sessionId) {
    ctx.post({
      type: "toast",
      text: "No active session to rename yet",
    });
    return;
  }
  if (!title) {
    const picked = await vscode.window.showInputBox({
      prompt: "New session title",
      placeHolder: "e.g. Auth refactor",
      ignoreFocusOut: true,
    });
    if (!picked?.trim()) {
      return;
    }
    title = picked.trim();
  }
  const result = renameSession(sessionId, title);
  if (!result.ok) {
    ctx.post({
      type: "error",
      text: result.error || "Rename failed",
    });
    return;
  }
  ctx.post({ type: "toast", text: `Renamed to “${result.title}”` });
  // Refresh history list if open
  handleListHistory(ctx);
}

async function handleSetModel(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const modelId = typeof msg.modelId === "string" ? msg.modelId : "";
  const reasoningEffort =
    typeof msg.reasoningEffort === "string" ? msg.reasoningEffort : undefined;
  if (!modelId) {
    ctx.post({ type: "error", text: "Model id required" });
    return;
  }
  try {
    const models = await ctx.agent.setModel(modelId, reasoningEffort);
    ctx.log?.(
      `[model] set ${modelId}` +
        (reasoningEffort ? ` effort=${reasoningEffort}` : "")
    );
    ctx.post({ type: "models", ...models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[model] set error ${message}`);
    ctx.post({ type: "error", text: message });
  }
}
