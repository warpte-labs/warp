import * as vscode from "vscode";
import { EventEmitter } from "events";
import {
  AcpClient,
  type AvailableCommand,
  type ContextUsage,
  type ModelState,
  type PromptAttachment,
  type TasksSnapshot,
  type WarpTask,
} from "./acpClient";
import { getAuthStatus } from "./auth";
import {
  type PermissionMode,
  getAutoCompactPercent,
  getMockMode,
  getPermissionMode as readPermissionMode,
  setPermissionMode as persistPermissionMode,
} from "./config";
import { confirmEnableYolo } from "./security/permissions";

/**
 * Chat backend for Warp.
 *
 * Emits (webview contract):
 *   thought  { text }              — ACP agent_thought_chunk (delta)
 *   message  { text }              — ACP agent_message_chunk (delta)
 *   tool     { id, title, status }
 *   task     { event, task, snapshot } — multi-agent lifecycle (subagent/bg)
 *   tasks    TasksSnapshot         — full board snapshot
 *   turn     { phase: "start" | "end" }
 *   models   ModelState
 *   context  ContextUsage
 *   compact  { phase: start|end|error, ... }
 *   commands { commands: AvailableCommand[] }
 *   permissionMode { permissionMode, alwaysApprove }
 *   status | error | stderr | ready
 */
export class AgentProcess extends EventEmitter implements vscode.Disposable {
  private readonly acp = new AcpClient();
  private wired = false;
  private permissionMode: PermissionMode = "ask";
  private turnActive = false;
  private autoCompactBusy = false;
  private lastAutoCompactAt = 0;

  constructor() {
    super();
    // Seed permission mode from settings before first spawn
    this.permissionMode = readPermissionMode();
    this.acp.setPermissionMode(this.permissionMode);
    this.wireAcp();
  }

  private wireAcp(): void {
    if (this.wired) {
      return;
    }
    this.wired = true;
    this.acp.on("thought", (p: { text: string }) => this.emit("thought", p));
    this.acp.on("message", (p: { text: string }) => this.emit("message", p));
    this.acp.on("tool", (p: unknown) => this.emit("tool", p));
    this.acp.on("task", (p: unknown) => this.emit("task", p));
    this.acp.on("tasks", (p: TasksSnapshot) => this.emit("tasks", p));
    this.acp.on("status", (t: string) => this.emit("status", t));
    this.acp.on("stderr", (t: string) => this.emit("stderr", t));
    this.acp.on("error", (t: string) => this.emit("error", t));
    this.acp.on("ready", (p: unknown) => this.emit("ready", p));
    this.acp.on("models", (p: ModelState) => this.emit("models", p));
    this.acp.on("context", (p: ContextUsage) => {
      this.emit("context", p);
      // Only auto-compact between turns (mid-stream would fight the agent)
      if (!this.turnActive) {
        void this.maybeAutoCompact();
      }
    });
    this.acp.on("compact", (p: unknown) => this.emit("compact", p));
    this.acp.on("commands", (p: unknown) => this.emit("commands", p));
    // Permission mode is owned by AgentProcess (not acp spawn noise).
  }

  getModelState(): ModelState {
    return this.acp.getModelState();
  }

  getContextUsage(): ContextUsage {
    return this.acp.getContextUsage();
  }

  getAvailableCommands(): AvailableCommand[] {
    return this.acp.getAvailableCommands();
  }

  getTasksSnapshot(): TasksSnapshot {
    return this.acp.getTasksSnapshot();
  }

  getTask(id: string): WarpTask | undefined {
    return this.acp.getTask(id);
  }

  getAlwaysApprove(): boolean {
    return this.permissionMode === "yolo";
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  getSessionId(): string | null {
    return this.acp.getSessionId();
  }

  private emitPermissionMode(): void {
    this.emit("permissionMode", {
      permissionMode: this.permissionMode,
      alwaysApprove: this.permissionMode === "yolo",
    });
  }

  /**
   * Set ask | auto | yolo. Confirm before enabling YOLO.
   *
   * Grok mapping:
   *  - ask  → prompt every tool (ACP session/request_permission → QuickPick)
   *  - auto → Warp allows safe/read tools; writes/shell still prompt
   *           (same process as ask — no restart; matches Grok `/auto` spirit)
   *  - yolo → agent --always-approve (restart required when flag flips)
   *
   * Only YOLO changes spawn flags. Restarting for ask↔auto caused
   * "Agent process exited" when the old process exit raced the new session.
   */
  async setPermissionMode(mode: PermissionMode): Promise<PermissionMode> {
    const next: PermissionMode =
      mode === "auto" || mode === "yolo" || mode === "ask" ? mode : "ask";
    if (next === this.permissionMode) {
      this.emitPermissionMode();
      return this.permissionMode;
    }
    if (next === "yolo" && this.permissionMode !== "yolo") {
      const ok = await confirmEnableYolo();
      if (!ok) {
        this.emitPermissionMode();
        return this.permissionMode;
      }
    }
    const prev = this.permissionMode;
    this.permissionMode = next;
    this.acp.setPermissionMode(next);
    try {
      await persistPermissionMode(next);
    } catch {
      /* ignore settings write failures */
    }
    this.emitPermissionMode();

    const labels: Record<PermissionMode, string> = {
      ask: "Ask",
      auto: "Auto",
      yolo: "Yolo",
    };
    const label = labels[next];

    // Only --always-approve (yolo) changes the process argv
    const needRestart = (prev === "yolo") !== (next === "yolo");
    if (!needRestart) {
      this.emit("status", `${label} mode`);
      return next;
    }
    if (this.mockMode()) {
      this.emit("status", `${label} mode (mock)`);
      return next;
    }

    // session/new after restart returns default effort (often high). Save and
    // re-apply so YOLO does not wipe the user's chosen reasoning effort.
    const saved = this.acp.getModelState();
    const savedModelId = saved.currentModelId;
    const savedEffort = saved.reasoningEffort;

    this.acp.stop();
    const auth = getAuthStatus();
    if (auth.signedIn) {
      try {
        await this.acp.ensureSession();
        if (savedModelId) {
          try {
            await this.acp.setModel(savedModelId, savedEffort);
          } catch {
            /* session is up; effort restore is best-effort */
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Don't leave UI thinking yolo/ask flipped if restart failed
        this.emit("error", `Agent restart failed: ${message}`);
        this.emitPermissionMode();
        throw e;
      }
    }
    // Re-assert after session start so UI never snaps back to ask
    this.emitPermissionMode();
    this.emit("status", `${label} mode — agent restarted`);
    return next;
  }

  /** @deprecated prefer setPermissionMode */
  async setAlwaysApprove(on: boolean): Promise<boolean> {
    const mode = await this.setPermissionMode(on ? "yolo" : "ask");
    return mode === "yolo";
  }

  private mockMode(): boolean {
    return getMockMode();
  }

  async ensureStarted(): Promise<void> {
    if (this.mockMode()) {
      this.emit("models", {
        currentModelId: "grok-4.5",
        reasoningEffort: "high",
        availableModels: [
          {
            modelId: "grok-4.5",
            name: "Grok 4.5",
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              {
                id: "high",
                value: "high",
                label: "High Effort",
                default: true,
              },
              { id: "medium", value: "medium", label: "Medium Effort" },
              { id: "low", value: "low", label: "Low Effort" },
            ],
          },
        ],
      } satisfies ModelState);
      return;
    }
    const auth = getAuthStatus();
    if (!auth.signedIn) {
      throw new Error(
        "Not signed in. Use Warp: Sign In (Grok account) first."
      );
    }
    await this.acp.ensureSession();
  }

  async restart(): Promise<void> {
    this.acp.stop();
    if (!this.mockMode()) {
      await this.ensureStarted();
    }
  }

  /** Clear to a brand-new agent conversation (session/new). */
  async newChat(): Promise<string | null> {
    if (this.mockMode()) {
      this.emit("status", "New chat (mock)");
      this.emit("tasks", {
        tasks: [],
        running: 0,
        updatedAt: Date.now(),
      } satisfies TasksSnapshot);
      return "mock";
    }
    const auth = getAuthStatus();
    if (!auth.signedIn) {
      // Still allow UI clear; next prompt will ask to sign in
      this.emit("status", "New chat — sign in to start a live session");
      return null;
    }
    const id = await this.acp.newChat();
    this.emit("status", `New chat ${id.slice(0, 8)}…`);
    this.emit("tasks", this.acp.getTasksSnapshot());
    return id;
  }

  /** Compress conversation via Grok `/compact` (session/prompt). */
  async compact(hint?: string): Promise<void> {
    if (this.mockMode()) {
      this.emit("compact", {
        phase: "start",
        reason: "manual",
        tokensUsed: 420_000,
        contextWindow: 500_000,
        percentage: 84,
      });
      await sleep(800);
      this.emit("compact", {
        phase: "end",
        tokensBefore: 420_000,
        tokensAfter: 40_000,
        elapsedMs: 800,
      });
      this.emit("context", {
        usedTokens: 40_000,
        totalTokens: 500_000,
      });
      return;
    }
    const auth = getAuthStatus();
    if (!auth.signedIn) {
      throw new Error("Not signed in");
    }
    await this.acp.compact(hint);
  }

  async setModel(
    modelId: string,
    reasoningEffort?: string
  ): Promise<ModelState> {
    if (this.mockMode()) {
      const mock: ModelState = {
        currentModelId: modelId || "grok-4.5",
        reasoningEffort: reasoningEffort || "high",
        availableModels: [
          {
            modelId: "grok-4.5",
            name: "Grok 4.5",
            supportsReasoningEffort: true,
            reasoningEffort: reasoningEffort || "high",
            reasoningEfforts: [
              {
                id: "high",
                value: "high",
                label: "High Effort",
                default: true,
              },
              { id: "medium", value: "medium", label: "Medium Effort" },
              { id: "low", value: "low", label: "Low Effort" },
            ],
          },
        ],
      };
      this.emit("models", mock);
      return mock;
    }
    const auth = getAuthStatus();
    if (!auth.signedIn) {
      throw new Error("Not signed in");
    }
    return this.acp.setModel(modelId, reasoningEffort);
  }

  /**
   * User stop — cancel prompt/tools/subagents; UI shows "Agent interrupted".
   */
  cancelTurn(): void {
    if (this.mockMode()) {
      this.turnActive = false;
      this.emit("cancelled", { reason: "user" });
      this.emit("turn", { phase: "end" });
      return;
    }
    try {
      this.acp.cancelTurn();
    } catch {
      try {
        this.acp.stop();
      } catch {
        /* ignore */
      }
    }
    this.turnActive = false;
    this.emit("cancelled", { reason: "user" });
    this.emit("turn", { phase: "end" });
  }

  async sendPrompt(
    text: string,
    attachments?: PromptAttachment[]
  ): Promise<void> {
    this.turnActive = true;
    this.emit("turn", { phase: "start" });

    if (this.mockMode()) {
      try {
        await this.runMockTurn();
      } finally {
        this.turnActive = false;
        this.emit("turn", { phase: "end" });
        void this.maybeAutoCompact();
      }
      return;
    }

    try {
      await this.ensureStarted();
      await this.acp.prompt(text, attachments);
      // cancelTurn may already have ended the turn
      if (this.turnActive) {
        this.turnActive = false;
        this.emit("turn", { phase: "end" });
        void this.maybeAutoCompact();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.turnActive = false;
      if (/cancelled|canceled|interrupted|Agent stopped/i.test(message)) {
        // cancelTurn already emitted cancelled + turn end
        this.emit("turn", { phase: "end" });
        return;
      }
      this.emit("error", message);
      this.emit("turn", { phase: "end" });
      throw e;
    }
  }

  /**
   * When context usage ≥ warp.autoCompactPercent (1–100), run /compact.
   * 0 = disabled. Cooldown 45s so we don't loop.
   */
  private async maybeAutoCompact(): Promise<void> {
    if (this.autoCompactBusy || this.turnActive || this.mockMode()) return;
    const threshold = getAutoCompactPercent();
    if (threshold <= 0) return;

    const { usedTokens, totalTokens } = this.acp.getContextUsage();
    if (!totalTokens || totalTokens <= 0) return;
    const pct = Math.round((usedTokens / totalTokens) * 100);
    if (pct < threshold) return;

    const now = Date.now();
    if (now - this.lastAutoCompactAt < 45_000) return;

    this.autoCompactBusy = true;
    this.lastAutoCompactAt = now;
    try {
      this.emit(
        "status",
        `Auto-compact at ${pct}% (threshold ${threshold}%)…`
      );
      await this.compact("auto — context threshold");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.emit("error", `Auto-compact failed: ${message}`);
    } finally {
      this.autoCompactBusy = false;
    }
  }

  /** Offline demo: markdown thought then markdown answer (delta chunks). */
  private async runMockTurn(): Promise<void> {
    const thought = `Looking at blast radius and rollback speed.

- **Canary first** at 5% keeps risk low if p95 regresses
- Hold each stage long enough to see signal
- Keep prior artifact warm for one-click rollback

Edge config should expose a single \`rollback\` flag.`;

    const answer = `Staged rollout:

1. **Canary 5%** — watch health + p95 for 15m
2. **Widen to 25%** — same checks
3. **100%** — only if green

Also pin the previous artifact for 24h.

\`\`\`bash
edge set rollback=prev-artifact
\`\`\`

On-call checklist:
- verify health probes
- watch p95 latency
- hold canary 15m
- promote or roll back`;

    await emitDeltas(thought, 3, 16, (delta) =>
      this.emit("thought", { text: delta })
    );
    await sleep(100);
    await emitDeltas(answer, 4, 16, (delta) =>
      this.emit("message", { text: delta })
    );
  }

  stop(): void {
    this.acp.stop();
  }

  dispose(): void {
    this.acp.dispose();
    this.removeAllListeners();
  }
}

async function emitDeltas(
  full: string,
  charsPerTick: number,
  tickMs: number,
  onDelta: (delta: string) => void
): Promise<void> {
  let i = 0;
  while (i < full.length) {
    const next = Math.min(full.length, i + charsPerTick);
    onDelta(full.slice(i, next));
    i = next;
    await sleep(tickMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
