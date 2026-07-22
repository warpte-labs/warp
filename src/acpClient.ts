import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { EventEmitter } from "events";
import { handleClientRequest, type JsonRpcId } from "./acp/clientRequests";
import { textFromContent } from "./acp/content";
import {
  applyModelChanged,
  contextWindowOf,
  emptyModelState,
  parseModelState,
  REASONING_EFFORT_META_KEY,
  type ContextUsage,
  type ModelState,
} from "./acp/models";
import {
  buildPromptContent,
  type PromptAttachment,
} from "./acp/promptContent";
import { parseToolUpdate } from "./acp/toolParse";
import { TaskRegistry, type TasksSnapshot, type WarpTask } from "./acp/tasks";
import {
  binaryLooksAvailable,
  missingBinaryHelp,
  resolveBinary,
  workspaceCwd,
} from "./paths";
import { getSubagentsEnabled } from "./config";

export type { PromptAttachment } from "./acp/promptContent";
export type { ToolUiEvent } from "./acp/toolParse";
export type { WarpTask, TasksSnapshot, TaskKind, TaskStatus } from "./acp/tasks";
export type {
  ModelState,
  ModelInfo,
  ReasoningEffortOption,
  ContextUsage,
} from "./acp/models";
export { displayModelLabel, formatTokenCount, contextWindowOf } from "./acp/models";

export type AvailableCommand = {
  name: string;
  description: string;
  inputHint?: string;
  source?: string;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** wall-clock timeout handle */
  timer: ReturnType<typeof setTimeout>;
  /** ms; session/prompt uses a long window and is refreshed on stream */
  timeoutMs: number;
  method: string;
};

/** Default RPC timeout (initialize, set_model, …). */
const ACP_RPC_TIMEOUT_MS = 120_000;
/**
 * Multi-agent / long tool turns often exceed 2 minutes.
 * session/prompt stays open until the turn finishes — refresh on stream.
 */
const ACP_PROMPT_TIMEOUT_MS = 20 * 60_000;

/**
 * Minimal ACP NDJSON client over agent stdio.
 *
 * Flow: initialize → session/new → session/prompt
 * Parsing helpers live in src/acp/* — keep this class transport-only.
 */
export class AcpClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private sessionId: string | null = null;
  private starting: Promise<void> | null = null;
  private modelState: ModelState = emptyModelState();
  private contextUsage: ContextUsage = { usedTokens: 0, totalTokens: 500_000 };
  private availableCommands: AvailableCommand[] = [];
  /** Warp tool policy — applied on next spawn. */
  private permissionMode: "ask" | "auto" | "yolo" = "ask";
  /** Multi-agent / bg task board (parent session). */
  private readonly tasks = new TaskRegistry();
  /** User hit Stop — ignore stream until next prompt. */
  private streamMuted = false;

  get connected(): boolean {
    return this.child !== null && !this.child.killed && this.sessionId !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getModelState(): ModelState {
    return this.modelState;
  }

  getContextUsage(): ContextUsage {
    return this.contextUsage;
  }

  getAvailableCommands(): AvailableCommand[] {
    return this.availableCommands.slice();
  }

  getTasksSnapshot(): TasksSnapshot {
    return this.tasks.snapshot();
  }

  getTask(id: string): WarpTask | undefined {
    return this.tasks.get(id);
  }

  getAlwaysApprove(): boolean {
    return this.permissionMode === "yolo";
  }

  getPermissionMode(): "ask" | "auto" | "yolo" {
    return this.permissionMode;
  }

  /**
   * Used on next spawn when YOLO flag changes.
   * Maps to Grok CLI:
   *  - yolo → agent --always-approve stdio
   *  - ask / auto → agent stdio
   *
   * Auto is enforced in Warp (session/request_permission + safe-tool allow),
   * matching Grok `/auto` semantics without a process restart. Restarting for
   * auto caused "Agent process exited" races (stale exit handlers).
   */
  setPermissionMode(mode: "ask" | "auto" | "yolo"): void {
    this.permissionMode =
      mode === "auto" || mode === "yolo" || mode === "ask" ? mode : "ask";
  }

  /** @deprecated prefer setPermissionMode */
  setAlwaysApprove(on: boolean): void {
    this.permissionMode = on ? "yolo" : "ask";
  }

  /** Build `grok …` argv for ACP stdio with the current permission policy. */
  private agentStdioArgs(): string[] {
    if (this.permissionMode === "yolo") {
      // Same as --permission-mode bypassPermissions / --yolo
      return ["agent", "--always-approve", "stdio"];
    }
    // ask + auto share the same process flags; auto is client-side policy
    return ["agent", "stdio"];
  }

  private emitContext(): void {
    this.contextUsage = {
      ...this.contextUsage,
      totalTokens: contextWindowOf(this.modelState) || this.contextUsage.totalTokens,
    };
    this.emit("context", this.contextUsage);
  }

  private noteTokensFromMeta(meta: unknown): void {
    if (!meta || typeof meta !== "object") return;
    const m = meta as Record<string, unknown>;
    const used =
      typeof m.totalTokens === "number"
        ? m.totalTokens
        : typeof m.total_tokens === "number"
          ? m.total_tokens
          : typeof m.usedTokens === "number"
            ? m.usedTokens
            : null;
    if (used != null && used >= 0) {
      this.contextUsage = {
        usedTokens: used,
        totalTokens:
          contextWindowOf(this.modelState) || this.contextUsage.totalTokens,
      };
      this.emit("context", this.contextUsage);
    }
  }

  async ensureSession(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async prompt(
    text: string,
    attachments?: PromptAttachment[]
  ): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) {
      throw new Error("No ACP session");
    }
    const prompt = buildPromptContent(text, attachments);
    if (!prompt.length) {
      throw new Error("Empty prompt");
    }
    this.streamMuted = false;
    try {
      await this.request(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt,
        },
        ACP_PROMPT_TIMEOUT_MS
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancelled|canceled|interrupted|Agent stopped/i.test(msg)) {
        return; // user stop — not a hard error
      }
      throw e;
    }
  }

  /**
   * User stop: cancel in-flight prompt, mute stream, kill agent process
   * so tools/subagents halt. Next send restarts a clean session.
   */
  cancelTurn(): void {
    this.streamMuted = true;
    for (const [id, p] of this.pending) {
      if (p.method === "session/prompt" || p.method === "session/cancel") {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(new Error("cancelled"));
      }
    }
    // Best-effort ACP cancel before kill
    if (this.sessionId && this.child?.stdin.writable) {
      try {
        this.child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId: this.sessionId },
          }) + "\n"
        );
      } catch {
        /* ignore */
      }
    }
    // Hard stop process so shell tools / subagents actually die
    this.stop();
    this.emit("cancelled", { reason: "user" });
  }

  async newChat(): Promise<string> {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      this.sessionId = null;
      await this.ensureSession();
      if (!this.sessionId) {
        throw new Error("Failed to start a new session");
      }
      return this.sessionId;
    }

    const cwd = workspaceCwd();
    const sess = await this.request("session/new", {
      cwd,
      mcpServers: [],
    });

    this.applySessionNew(sess);
    this.emit("status", `New session ${this.sessionId!.slice(0, 8)}…`);
    this.emitReady();
    return this.sessionId!;
  }

  /**
   * Switch model and/or reasoning effort via session/set_model.
   * Effort uses _meta.reasoningEffort (REASONING_EFFORT_META_KEY).
   */
  /**
   * Compress conversation history (Grok: session/prompt with "/compact").
   * Optional hint is appended after the slash command.
   */
  async compact(hint?: string): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) {
      throw new Error("No ACP session");
    }
    const text =
      typeof hint === "string" && hint.trim()
        ? `/compact ${hint.trim()}`
        : "/compact";
    const total =
      contextWindowOf(this.modelState) || this.contextUsage.totalTokens || 0;
    const used = this.contextUsage.usedTokens || 0;
    const percentage =
      total > 0 ? Math.min(100, Math.round((used / total) * 100)) : undefined;
    this.emit("compact", {
      phase: "start",
      reason: "manual",
      tokensUsed: used || undefined,
      contextWindow: total || undefined,
      percentage,
    });
    try {
      await this.request(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt: [{ type: "text", text }],
        },
        ACP_PROMPT_TIMEOUT_MS
      );
    } catch (e) {
      this.emit("compact", {
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async setModel(
    modelId: string,
    reasoningEffort?: string
  ): Promise<ModelState> {
    await this.ensureSession();
    if (!this.sessionId) {
      throw new Error("No ACP session");
    }
    const id = modelId.trim();
    if (!id) {
      throw new Error("modelId required");
    }
    const params: Record<string, unknown> = {
      sessionId: this.sessionId,
      modelId: id,
    };
    if (reasoningEffort) {
      params._meta = { [REASONING_EFFORT_META_KEY]: reasoningEffort };
    }
    await this.request("session/set_model", params);

    // Optimistically update; model_changed notification may refine.
    const next = applyModelChanged(this.modelState, {
      modelId: id,
      reasoningEffort: reasoningEffort || this.modelState.reasoningEffort,
    });
    this.modelState = next;
    this.emit("models", this.modelState);
    return this.modelState;
  }

  stop(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Agent stopped"));
    }
    this.pending.clear();
    this.sessionId = null;
    this.modelState = emptyModelState();
    this.contextUsage = { usedTokens: 0, totalTokens: 500_000 };
    this.availableCommands = [];
    this.tasks.clear();
    this.emit("tasks", this.tasks.snapshot());
    // Clear current child *before* kill so the async exit handler does not
    // treat a superseded process as live and wipe a newly spawned session.
    const prev = this.child;
    this.child = null;
    if (prev) {
      try {
        prev.kill();
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  private async start(): Promise<void> {
    this.stop();

    const binary = resolveBinary();
    if (!binaryLooksAvailable(binary)) {
      throw new Error(missingBinaryHelp(binary));
    }
    const cwd = workspaceCwd();
    const args = this.agentStdioArgs();
    this.tasks.clear();
    this.emit("tasks", this.tasks.snapshot());
    this.emit("status", `Starting ${binary} ${args.join(" ")}…`);
    // Do not emit permissionMode here — AgentProcess owns the UI source of
    // truth. Emitting ask when YOLO is off used to clobber "auto" after restart.

    // Multi-agent: never pass --no-subagents; set GROK_SUBAGENTS from Warp setting.
    const subagentsOn = getSubagentsEnabled();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GROK_SUBAGENTS: subagentsOn ? "1" : "0",
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
        windowsHide: true,
      });
      this.child = child;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ENOENT|not found|spawn/i.test(msg)) {
        throw new Error(missingBinaryHelp(binary));
      }
      throw new Error(`Failed to spawn agent: ${msg}`);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) {
          this.onLine(line);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      const text = chunk.toString("utf8").trim();
      if (text) {
        this.emit("stderr", text);
      }
    });

    child.on("error", (err) => {
      // Ignore errors from a process we already replaced/stopped
      if (this.child !== child) return;
      // Async spawn failures (ENOENT) often land here instead of throw
      const msg = /ENOENT/i.test(err.message)
        ? missingBinaryHelp(binary)
        : `Agent process error: ${err.message}`;
      this.emit("error", msg);
      this.child = null;
      this.sessionId = null;
    });

    child.on("exit", (code, signal) => {
      // Critical: a killed previous agent exits *after* a new one may have
      // started. Only tear down if this exit is still the active child.
      if (this.child !== child) {
        return;
      }
      this.emit(
        "status",
        `Agent exited (code=${code ?? "?"}, signal=${signal ?? "none"})`
      );
      this.child = null;
      this.sessionId = null;
      for (const [, p] of this.pending) {
        p.reject(new Error("Agent process exited"));
      }
      this.pending.clear();
    });

    const init = (await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "warp", version: "0.5.0", title: "Warp" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    })) as {
      authMethods?: Array<{ id: string; name?: string }>;
      protocolVersion?: number;
    };

    this.emit(
      "status",
      `ACP initialize ok (protocol v${init?.protocolVersion ?? "?"})`
    );

    const methods = init?.authMethods ?? [];
    const cached = methods.find((m) => m.id === "cached_token");
    if (cached) {
      try {
        await this.request("authenticate", { methodId: "cached_token" });
        this.emit("status", "Authenticated via cached Grok token");
      } catch (e) {
        this.emit(
          "status",
          `cached_token auth skipped: ${e instanceof Error ? e.message : e}`
        );
      }
    }

    const sess = await this.request("session/new", {
      cwd,
      mcpServers: [],
    });

    this.applySessionNew(sess);
    this.emit("status", `Session ${this.sessionId!.slice(0, 8)}… ready`);
    this.emitReady();
  }

  private applySessionNew(sess: unknown): void {
    const rec = sess && typeof sess === "object" ? (sess as Record<string, unknown>) : null;
    const sessionId =
      typeof rec?.sessionId === "string" ? rec.sessionId : null;
    if (!sessionId) {
      throw new Error("session/new did not return sessionId");
    }
    this.sessionId = sessionId;
    // New parent session → fresh multi-agent board
    this.tasks.clear();
    this.emit("tasks", this.tasks.snapshot());
    const models = parseModelState(sess);
    if (models) {
      this.modelState = models;
      this.emit("models", this.modelState);
      this.emitContext();
    }
  }

  private emitReady(): void {
    this.emit("ready", {
      sessionId: this.sessionId,
      models: this.modelState,
      tasks: this.tasks.snapshot(),
    });
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number = ACP_RPC_TIMEOUT_MS
  ): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Agent stdin not writable"));
    }
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    this.child.stdin.write(JSON.stringify(msg) + "\n");
    return new Promise((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        method,
        timeoutMs,
        timer: setTimeout(() => {
          /* replaced by armTimeout */
        }, 0),
      };
      this.pending.set(id, entry);
      this.armTimeout(id, entry);
    });
  }

  private armTimeout(id: JsonRpcId, entry: Pending): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.pending.get(id) === entry) {
        this.pending.delete(id);
        entry.reject(new Error(`ACP timeout: ${entry.method}`));
      }
    }, entry.timeoutMs);
  }

  /**
   * Long turns (esp. multi-agent) keep streaming session/update while
   * session/prompt is still open. Refresh the prompt deadline so we don't
   * kill a healthy turn at 2 minutes.
   */
  private touchPromptTimeouts(): void {
    for (const [id, p] of this.pending) {
      if (p.method === "session/prompt") {
        this.armTimeout(id, p);
      }
    }
  }

  private respond(id: JsonRpcId, result: unknown): void {
    if (!this.child?.stdin.writable) {
      return;
    }
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"
    );
  }

  private respondError(id: JsonRpcId, message: string): void {
    if (!this.child?.stdin.writable) {
      return;
    }
    this.child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      }) + "\n"
    );
  }

  private onLine(line: string): void {
    let msg: {
      id?: JsonRpcId;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string; code?: number; data?: unknown };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      this.emit("stderr", `non-json: ${line.slice(0, 200)}`);
      return;
    }

    if (
      msg.id != null &&
      (msg.result !== undefined || msg.error) &&
      !msg.method
    ) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          p.reject(
            new Error(msg.error.message || JSON.stringify(msg.error))
          );
        } else {
          p.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method && msg.id != null) {
      void handleClientRequest(msg.method, msg.id, msg.params || {}, {
        respond: (id, result) => this.respond(id, result),
        respondError: (id, message) => this.respondError(id, message),
      });
      return;
    }

    // Standard ACP streaming (Grok agent mode)
    if (
      (msg.method === "session/update" || msg.method === "session_update") &&
      msg.params
    ) {
      // Grok puts live usage on params._meta.totalTokens
      this.noteTokensFromMeta(msg.params._meta);
      this.touchPromptTimeouts();
      this.handleSessionUpdate(msg.params);
      return;
    }

    if (msg.method?.startsWith("_x.ai/") || msg.method?.startsWith("x.ai/")) {
      this.handleXaiNotification(msg.method, msg.params || {});
      return;
    }
  }

  private handleXaiNotification(
    method: string,
    params: Record<string, unknown>
  ): void {
    // Grok also streams prompt turns as x.ai/session/update (same payload shape)
    if (
      method === "_x.ai/session/update" ||
      method === "x.ai/session/update" ||
      method.endsWith("/session/update")
    ) {
      this.noteTokensFromMeta(params._meta);
      this.touchPromptTimeouts();
      this.handleSessionUpdate(params);
      return;
    }

    // Full model catalog refresh
    if (
      method === "_x.ai/models/update" ||
      method === "x.ai/models/update" ||
      method.endsWith("/models/update")
    ) {
      const models = parseModelState(params);
      if (models) {
        this.modelState = models;
        this.emit("models", this.modelState);
        this.emitContext();
      }
      return;
    }

    // model_changed + compact lifecycle under session_notification.update
    if (
      method === "_x.ai/session_notification" ||
      method === "x.ai/session_notification" ||
      method.endsWith("/session_notification")
    ) {
      const update = params.update as Record<string, unknown> | undefined;
      if (!update) {
        return;
      }
      const kind = String(update.sessionUpdate || "");
      if (kind === "model_changed") {
        this.modelState = applyModelChanged(this.modelState, update);
        this.emit("models", this.modelState);
        this.emitContext();
        return;
      }
      if (kind === "auto_compact_started") {
        this.emit("compact", {
          phase: "start",
          reason: typeof update.reason === "string" ? update.reason : "auto",
          tokensUsed:
            typeof update.tokens_used === "number"
              ? update.tokens_used
              : undefined,
          contextWindow:
            typeof update.context_window === "number"
              ? update.context_window
              : undefined,
          percentage:
            typeof update.percentage === "number"
              ? update.percentage
              : undefined,
        });
        return;
      }
      if (kind === "auto_compact_completed") {
        const after =
          typeof update.tokens_after === "number"
            ? update.tokens_after
            : typeof update.tokensAfter === "number"
              ? update.tokensAfter
              : undefined;
        if (after != null) {
          this.contextUsage = {
            usedTokens: after,
            totalTokens:
              contextWindowOf(this.modelState) || this.contextUsage.totalTokens,
          };
          this.emit("context", this.contextUsage);
        }
        const before =
          typeof update.tokens_before === "number"
            ? update.tokens_before
            : typeof update.tokensBefore === "number"
              ? update.tokensBefore
              : undefined;
        this.emit("compact", {
          phase: "end",
          tokensBefore: before,
          tokensAfter: after,
          elapsedMs:
            typeof update.elapsed_ms === "number"
              ? update.elapsed_ms
              : typeof update.elapsedMs === "number"
                ? update.elapsedMs
                : undefined,
          summaryPreview:
            typeof update.summary_preview === "string"
              ? update.summary_preview
              : null,
        });
        return;
      }
      if (kind === "auto_compact_failed") {
        this.emit("compact", {
          phase: "error",
          error:
            typeof update.error === "string" ? update.error : "Compact failed",
        });
      }
    }
  }

  private noteTaskFromTool(
    update: Record<string, unknown>,
    isStart: boolean
  ): void {
    try {
      const hit = this.tasks.ingestToolUpdate(update, isStart);
      if (!hit) return;
      this.emit("task", {
        event: hit.event,
        task: hit.task,
        snapshot: this.tasks.snapshot(),
      });
      this.emit("tasks", this.tasks.snapshot());
    } catch {
      /* multi-agent tracking must never break the chat stream */
    }
  }

  private handleSessionUpdate(params: Record<string, unknown>): void {
    if (this.streamMuted) {
      return;
    }
    // Accept either { update: { sessionUpdate, ... } } or a flat update object
    const nested = params.update as Record<string, unknown> | undefined;
    const update =
      nested && typeof nested === "object"
        ? nested
        : (params as Record<string, unknown>);
    if (!update) {
      return;
    }
    // Also check update-level _meta
    this.noteTokensFromMeta(update._meta);
    this.noteTokensFromMeta(params._meta);
    const kind = String(
      update.sessionUpdate || update.session_update || ""
    );
    if (kind === "agent_message_chunk" || kind === "agent_message") {
      const text = textFromContent(update.content ?? update.delta);
      if (text) {
        this.emit("message", { text });
      }
    } else if (
      kind === "agent_thought_chunk" ||
      kind === "agent_thought" ||
      kind === "thought_chunk"
    ) {
      const text = textFromContent(update.content ?? update.delta);
      if (text) {
        this.emit("thought", { text });
      }
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const isStart = kind === "tool_call";
      this.emit("tool", parseToolUpdate(update, isStart));
      this.noteTaskFromTool(update, isStart);
    } else if (kind === "model_changed" || kind === "current_mode_update") {
      this.modelState = applyModelChanged(this.modelState, update);
      this.emit("models", this.modelState);
      this.emitContext();
    } else if (
      kind === "available_commands_update" ||
      kind === "available_commands"
    ) {
      this.applyAvailableCommands(update);
    }
  }

  private applyAvailableCommands(update: Record<string, unknown>): void {
    const raw =
      (update.availableCommands as unknown[]) ||
      (update.available_commands as unknown[]) ||
      (update.commands as unknown[]) ||
      [];
    if (!Array.isArray(raw)) {
      return;
    }
    const next: AvailableCommand[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const name = String(c.name || c.command || c.id || "").trim();
      if (!name) continue;
      const input = c.input as Record<string, unknown> | undefined;
      const hint =
        typeof input?.hint === "string"
          ? input.hint
          : typeof c.inputHint === "string"
            ? c.inputHint
            : typeof c.hint === "string"
              ? c.hint
              : undefined;
      next.push({
        name,
        description: String(c.description || c.desc || "").slice(0, 200),
        inputHint: hint,
        source:
          typeof c.source === "string"
            ? c.source
            : name.includes(":")
              ? "plugin"
              : "agent",
      });
    }
    this.availableCommands = next;
    this.emit("commands", { commands: next });
  }
}
