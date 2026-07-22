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
import { listWorkspaceFiles } from "./workspaceFiles";
import { workspaceCwd } from "./paths";

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
      ctx.pushAuthStatus();
      ctx.post({
        type: "permissionMode",
        alwaysApprove: ctx.agent.getAlwaysApprove(),
      });
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
    case "copyText":
      await handleCopyText(msg, ctx);
      return;
    case "exportChat":
      await handleExportChat(msg, ctx);
      return;
    case "renameSession":
      await handleRenameSession(msg, ctx);
      return;
    default:
      return;
  }
}

async function handlePrompt(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
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
    const message = err instanceof Error ? err.message : String(err);
    ctx.post({ type: "error", text: message });
    ctx.post({ type: "turn", phase: "end" });
  }
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
    ctx.post({
      type: "permissionMode",
      alwaysApprove: ctx.agent.getAlwaysApprove(),
    });
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

  for (const raw of paths.slice(0, 12)) {
    try {
      let filePath = raw.trim().replace(/^file:\/\//i, "");
      if (/^\/[A-Za-z]:\//.test(filePath)) {
        filePath = filePath.slice(1);
      }
      filePath = filePath.replace(/\//g, pathMod.sep);
      if (!pathMod.isAbsolute(filePath)) {
        filePath = pathMod.resolve(workspaceCwd(), filePath);
      }
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
        if (buf.length > 12 * 1024 * 1024) continue;
        items.push({
          name,
          mime,
          size: buf.length,
          isImage: true,
          dataBase64: buf.toString("base64"),
        });
      } else if (isTextName(name) && buf.length <= 4 * 1024 * 1024) {
        items.push({
          name,
          mime: "text/plain",
          size: buf.length,
          isImage: false,
          text: buf.toString("utf8"),
        });
      } else if (buf.length <= 4 * 1024 * 1024) {
        items.push({
          name,
          mime,
          size: buf.length,
          isImage: false,
          dataBase64: buf.toString("base64"),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log?.(`[attach] path error ${message}`);
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
    const cwd = workspaceCwd();
    let filePath = raw.trim().replace(/^file:\/\//, "").replace(/\//g, path.sep);
    // Strip surrounding quotes / backticks
    filePath = filePath.replace(/^['"`]+|['"`]+$/g, "");
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(cwd, filePath);
    }
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
    ctx.log?.(`[files] open ${filePath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[files] open error ${message}`);
    ctx.post({ type: "error", text: `Could not open file: ${message}` });
  }
}

async function handleCompact(
  msg: Record<string, unknown>,
  ctx: MessageContext
): Promise<void> {
  const hint = typeof msg.hint === "string" ? msg.hint : undefined;
  try {
    ctx.log?.(`[compact] start${hint ? " " + hint : ""}`);
    await ctx.agent.compact(hint);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
    ctx.post({ type: "permissionMode", alwaysApprove: next });
    ctx.post({
      type: "toast",
      text: next
        ? "Always-approve on (tools auto-allowed)"
        : "Ask mode (tools may prompt)",
    });
    ctx.log?.(`[perm] alwaysApprove=${next}`);
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
  const text = typeof msg.text === "string" ? msg.text : "";
  if (!text.trim()) {
    ctx.post({ type: "toast", text: "Nothing to export" });
    return;
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
    const message = err instanceof Error ? err.message : String(err);
    ctx.post({ type: "error", text: `Export failed: ${message}` });
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
