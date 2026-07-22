/**
 * Multi-agent / background task registry for Warp.
 *
 * Grok engine owns execution (spawn_subagent, bg shell, monitors, loops).
 * This module classifies ACP tool traffic into a stable task model the
 * webview can render later — no UI here.
 *
 * Spec: grokinfoxai/features.md (Subagents, Background Tasks, Worktrees)
 */

export type TaskKind =
  | "subagent"
  | "command"
  | "monitor"
  | "loop"
  | "unknown";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WarpTask = {
  /** Stable id (subagent/task id when known, else toolCallId). */
  id: string;
  toolCallId: string;
  /** Child session / bg task id from Grok when available. */
  subagentId?: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Short label (spawn description, command, etc.). */
  description: string;
  /** general-purpose | explore | plan | custom */
  subagentType?: string;
  capabilityMode?: string;
  isolation?: string;
  model?: string;
  worktreePath?: string;
  background?: boolean;
  /** Tool name as reported by ACP (spawn_subagent, …). */
  toolName?: string;
  lastTarget?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
};

export type TasksSnapshot = {
  tasks: WarpTask[];
  running: number;
  updatedAt: number;
};

/** Tool names that create or control multi-agent / bg work. */
const SUBAGENT_SPAWN = new Set([
  "spawn_subagent",
  "spawn_agent",
  "task",
  "task_tool",
]);

const SUBAGENT_POLL = new Set([
  "get_command_or_subagent_output",
  "wait_commands_or_subagents",
  "get_task_output",
  "wait_task",
]);

const SUBAGENT_KILL = new Set([
  "kill_command_or_subagent",
  "kill_task",
  "kill_command",
]);

const MONITOR = new Set(["monitor", "watch"]);

const LOOP = new Set([
  "scheduler_create",
  "scheduler_delete",
  "scheduler_list",
  "loop",
]);

const BG_SHELL = new Set([
  "run_terminal_command",
  "bash",
  "shell",
  "run_terminal",
]);

function now(): number {
  return Date.now();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function toolNameFromUpdate(update: Record<string, unknown>): string {
  const meta = asRecord(update._meta);
  const xai = asRecord(meta?.["x.ai/tool"]);
  const candidates = [
    xai?.name,
    xai?.label,
    update.kind,
    update.title,
    update.name,
    update.toolName,
  ];
  for (const c of candidates) {
    const s = str(c);
    if (s && /^[a-z][a-z0-9_./-]*$/i.test(s) && !s.startsWith("call-")) {
      // Prefer underscore tool names
      if (s.includes("_") || s.includes("/") || SUBAGENT_SPAWN.has(s.toLowerCase())) {
        return s.replace(/^.*\//, ""); // strip server/ prefix if any
      }
    }
  }
  for (const c of candidates) {
    const s = str(c).toLowerCase().replace(/\s+/g, "_");
    if (s.includes("spawn_subagent") || s === "task") return "spawn_subagent";
    if (s.includes("get_command_or_subagent") || s.includes("get_task_output")) {
      return "get_command_or_subagent_output";
    }
    if (s.includes("kill_command_or_subagent") || s.includes("kill_task")) {
      return "kill_command_or_subagent";
    }
    if (s.includes("monitor")) return "monitor";
    if (s.includes("scheduler") || s === "loop") return s.includes("delete")
      ? "scheduler_delete"
      : "scheduler_create";
  }
  const raw = str(xai?.name || update.kind || update.title);
  return raw.replace(/^.*\//, "");
}

function rawInputOf(update: Record<string, unknown>): Record<string, unknown> {
  const meta = asRecord(update._meta);
  const xai = asRecord(meta?.["x.ai/tool"]);
  return (
    asRecord(update.rawInput) ||
    asRecord(update.raw_input) ||
    asRecord(xai?.input) ||
    asRecord(update.input) ||
    {}
  );
}

function statusFromAcp(
  update: Record<string, unknown>,
  isStart: boolean
): TaskStatus {
  const s = str(update.status).toLowerCase();
  if (
    s === "failed" ||
    s === "error" ||
    s === "errored"
  ) {
    return "failed";
  }
  if (s === "cancelled" || s === "canceled" || s === "rejected") {
    return "cancelled";
  }
  if (s === "completed" || s === "success" || s === "done") {
    return "completed";
  }
  if (s === "pending" || s === "queued") {
    return "pending";
  }
  if (s === "in_progress" || s === "running" || s === "in-progress") {
    return "running";
  }
  return isStart ? "running" : "running";
}

function kindFromTool(
  toolName: string,
  input: Record<string, unknown>,
  update?: Record<string, unknown>
): TaskKind | null {
  const n = toolName.toLowerCase();
  const title = str(update?.title).toLowerCase();
  if (SUBAGENT_SPAWN.has(n) || n === "spawn_subagent") return "subagent";
  if (title.includes("[subagent:") || title.includes("spawn_subagent")) {
    return "subagent";
  }
  if (SUBAGENT_POLL.has(n) || SUBAGENT_KILL.has(n)) return null; // control, not new task
  if (MONITOR.has(n)) return "monitor";
  if (LOOP.has(n)) return "loop";
  if (BG_SHELL.has(n)) {
    // Only track shell when explicitly background
    if (input.background === true || input.background === "true") {
      return "command";
    }
    return null;
  }
  // Heuristic: tool title/description mentions subagent spawn
  if (n.includes("subagent") && n.includes("spawn")) return "subagent";
  // Grok Task tool often surfaces as a human description title only
  if (
    str(input.subagent_type) ||
    str(input.subagentType) ||
    str(input.prompt)
  ) {
    if (
      str(input.description) ||
      title.length > 0
    ) {
      // Only if it looks like a spawn (has prompt or subagent_type)
      if (str(input.subagent_type) || str(input.subagentType)) {
        return "subagent";
      }
    }
  }
  return null;
}

function descriptionFrom(
  kind: TaskKind,
  input: Record<string, unknown>,
  update: Record<string, unknown>
): string {
  const d =
    str(input.description) ||
    str(input.prompt)?.slice(0, 120) ||
    str(input.command)?.slice(0, 120) ||
    str(input.query)?.slice(0, 80) ||
    str(update.title) ||
    kind;
  return d || kind;
}

function extractSubagentId(
  update: Record<string, unknown>,
  input: Record<string, unknown>
): string | undefined {
  const candidates = [
    input.subagent_id,
    input.subagentId,
    input.task_id,
    input.taskId,
    input.id,
    update.subagentId,
    update.subagent_id,
    update.taskId,
    update.task_id,
  ];
  for (const c of candidates) {
    const s = str(c);
    if (s && s.length >= 4) return s;
  }
  // Arrays: task_ids
  const ids = input.task_ids ?? input.taskIds;
  if (Array.isArray(ids) && ids.length === 1) {
    const s = str(ids[0]);
    if (s) return s;
  }
  // Scan content / rawOutput for id-like fields
  const blob = JSON.stringify({
    content: update.content,
    rawOutput: update.rawOutput ?? update.raw_output,
    _meta: update._meta,
  });
  const m =
    blob.match(/"subagent_id"\s*:\s*"([^"]+)"/i) ||
    blob.match(/"task_id"\s*:\s*"([^"]+)"/i) ||
    blob.match(/"subagentId"\s*:\s*"([^"]+)"/i);
  if (m?.[1]) return m[1];
  return undefined;
}

function extractWorktreePath(update: Record<string, unknown>): string | undefined {
  const blob = JSON.stringify({
    content: update.content,
    rawOutput: update.rawOutput ?? update.raw_output,
    rawInput: update.rawInput,
    _meta: update._meta,
  });
  const m =
    blob.match(/"worktree[_]?path"\s*:\s*"([^"]+)"/i) ||
    blob.match(/worktrees[\\/][^"\\s]+/i);
  if (m?.[1]) return m[1].replace(/\\\\/g, "\\");
  if (m?.[0] && !m[1]) return m[0];
  return undefined;
}

function isTerminal(status: TaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function parseTitleSubagent(title: string): {
  type?: string;
  id?: string;
  cleanTitle?: string;
} | null {
  const s = str(title);
  if (!s.includes("[subagent:")) return null;
  const m = s.match(
    /\[subagent:([^\]]+)\]\s*([^(\n]*?)(?:\(([0-9a-f-]{8,})\))?/i
  );
  if (!m) return null;
  return {
    type: str(m[1]) || undefined,
    id: str(m[3]) || undefined,
    cleanTitle: str(m[2]) || undefined,
  };
}

/**
 * In-memory task board for one agent process / parent session.
 */
export class TaskRegistry {
  private tasks = new Map<string, WarpTask>();
  /** toolCallId → primary task id */
  private byToolCall = new Map<string, string>();

  clear(): void {
    this.tasks.clear();
    this.byToolCall.clear();
  }

  list(): WarpTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  get(id: string): WarpTask | undefined {
    return this.tasks.get(id);
  }

  runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "running" || t.status === "pending") n++;
    }
    return n;
  }

  snapshot(): TasksSnapshot {
    return {
      tasks: this.list(),
      running: this.runningCount(),
      updatedAt: now(),
    };
  }

  /**
   * Ingest a raw ACP tool_call / tool_call_update.
   * Returns the affected task (if any) for event emission.
   */
  ingestToolUpdate(
    update: Record<string, unknown>,
    isStart: boolean
  ): { task: WarpTask; event: "upsert" | "control" } | null {
    const toolCallId = str(
      update.toolCallId || update.tool_call_id || update.id
    );
    if (!toolCallId) return null;

    const toolName = toolNameFromUpdate(update);
    let input = rawInputOf(update);
    const acpStatus = statusFromAcp(update, isStart);
    const nameLower = toolName.toLowerCase();

    // ── Control tools: update existing tasks ─────────────────
    if (SUBAGENT_POLL.has(nameLower) || nameLower.includes("get_command_or_subagent")) {
      return this.applyPoll(toolCallId, update, input, acpStatus, toolName);
    }
    if (SUBAGENT_KILL.has(nameLower) || nameLower.includes("kill_command_or_subagent")) {
      return this.applyKill(toolCallId, update, input, acpStatus, toolName);
    }

    // Prefer ids from Grok titles: [subagent:explore] … (019f…)
    const titleTag = parseTitleSubagent(str(update.title));
    if (titleTag?.id && !str(input.subagent_id)) {
      input = { ...input, subagent_id: titleTag.id };
    }
    if (titleTag?.type && !str(input.subagent_type)) {
      input = { ...input, subagent_type: titleTag.type };
    }
    if (titleTag?.cleanTitle && !str(input.description)) {
      input = { ...input, description: titleTag.cleanTitle };
    }

    const kind = kindFromTool(toolName, input, update);
    if (!kind) {
      // Unknown / foreground tool — ignore for multi-agent registry
      return null;
    }

    return this.upsertSpawnOrBg(
      toolCallId,
      toolName || "spawn_subagent",
      kind,
      input,
      update,
      acpStatus,
      isStart
    );
  }

  private upsertSpawnOrBg(
    toolCallId: string,
    toolName: string,
    kind: TaskKind,
    input: Record<string, unknown>,
    update: Record<string, unknown>,
    acpStatus: TaskStatus,
    isStart: boolean
  ): { task: WarpTask; event: "upsert" } {
    const existingId = this.byToolCall.get(toolCallId);
    const prev = existingId ? this.tasks.get(existingId) : undefined;
    const t = now();

    const subagentId =
      extractSubagentId(update, input) || prev?.subagentId;
    const primaryId = subagentId || prev?.id || toolCallId;

    const background =
      input.background === true ||
      input.background === "true" ||
      prev?.background ||
      false;

    // Background spawn: tool may complete while child still runs
    let status = acpStatus;
    if (
      kind === "subagent" &&
      background &&
      acpStatus === "completed" &&
      !isStart
    ) {
      status = "running";
    }

    const isolation =
      str(input.isolation) || prev?.isolation || undefined;
    const subagentType =
      str(input.subagent_type) ||
      str(input.subagentType) ||
      str(input.agent_type) ||
      prev?.subagentType ||
      (kind === "subagent" ? "general-purpose" : undefined);

    const worktreePath =
      extractWorktreePath(update) ||
      (isolation === "worktree" ? prev?.worktreePath : undefined) ||
      prev?.worktreePath;

    const task: WarpTask = {
      id: primaryId,
      toolCallId,
      subagentId,
      kind,
      status,
      description: descriptionFrom(kind, input, update) || prev?.description || kind,
      subagentType,
      capabilityMode:
        str(input.capability_mode) ||
        str(input.capabilityMode) ||
        prev?.capabilityMode,
      isolation,
      model: str(input.model) || prev?.model,
      worktreePath,
      background,
      toolName,
      lastTarget:
        str(input.command) ||
        str(input.target_file) ||
        str(input.path) ||
        prev?.lastTarget,
      error:
        status === "failed"
          ? str(update.error) ||
            str((update as { message?: string }).message) ||
            prev?.error
          : undefined,
      startedAt: prev?.startedAt ?? t,
      updatedAt: t,
      endedAt: isTerminal(status) ? t : prev?.endedAt,
    };

    // Re-key if we learned a real subagent id
    if (prev && prev.id !== primaryId) {
      this.tasks.delete(prev.id);
    }
    this.tasks.set(primaryId, task);
    this.byToolCall.set(toolCallId, primaryId);
    if (subagentId) {
      this.tasks.set(subagentId, task);
    }

    return { task, event: "upsert" };
  }

  private applyPoll(
    toolCallId: string,
    update: Record<string, unknown>,
    input: Record<string, unknown>,
    acpStatus: TaskStatus,
    toolName: string
  ): { task: WarpTask; event: "control" } | null {
    const targetId =
      extractSubagentId(update, input) ||
      str(
        Array.isArray(input.task_ids)
          ? input.task_ids[0]
          : Array.isArray(input.taskIds)
            ? input.taskIds[0]
            : ""
      );
    if (!targetId) {
      return null;
    }

    const prev = this.tasks.get(targetId);
    const t = now();

    let status: TaskStatus = prev?.status || "running";
    if (acpStatus === "failed") {
      status = "failed";
    } else if (acpStatus === "cancelled") {
      status = "cancelled";
    } else if (
      acpStatus === "completed" &&
      !isStartLike(update) &&
      looksFinished(update)
    ) {
      status = "completed";
    } else if (prev?.status !== "completed" && prev?.status !== "failed") {
      status = "running";
    }

    const task: WarpTask = {
      id: targetId,
      toolCallId: prev?.toolCallId || toolCallId,
      subagentId: targetId,
      kind: prev?.kind || "subagent",
      status,
      description: prev?.description || "subagent",
      subagentType: prev?.subagentType,
      capabilityMode: prev?.capabilityMode,
      isolation: prev?.isolation,
      model: prev?.model,
      worktreePath: extractWorktreePath(update) || prev?.worktreePath,
      background: prev?.background ?? true,
      toolName: prev?.toolName || toolName,
      lastTarget: prev?.lastTarget,
      error:
        status === "failed" ? str(update.error) || prev?.error : prev?.error,
      startedAt: prev?.startedAt ?? t,
      updatedAt: t,
      endedAt: isTerminal(status) ? t : prev?.endedAt,
    };

    this.tasks.set(targetId, task);
    this.byToolCall.set(toolCallId, targetId);
    return { task, event: "control" };
  }

  private applyKill(
    toolCallId: string,
    update: Record<string, unknown>,
    input: Record<string, unknown>,
    acpStatus: TaskStatus,
    toolName: string
  ): { task: WarpTask; event: "control" } | null {
    const ids: string[] = [];
    const one = extractSubagentId(update, input);
    if (one) ids.push(one);
    const arr = input.task_ids ?? input.taskIds;
    if (Array.isArray(arr)) {
      for (const x of arr) {
        const s = str(x);
        if (s) ids.push(s);
      }
    }
    if (!ids.length) return null;

    const t = now();
    let last: WarpTask | null = null;
    for (const id of ids) {
      const prev = this.tasks.get(id);
      const task: WarpTask = {
        id,
        toolCallId: prev?.toolCallId || toolCallId,
        subagentId: id,
        kind: prev?.kind || "subagent",
        status:
          acpStatus === "failed" && !prev
            ? "failed"
            : "cancelled",
        description: prev?.description || "task",
        subagentType: prev?.subagentType,
        capabilityMode: prev?.capabilityMode,
        isolation: prev?.isolation,
        model: prev?.model,
        worktreePath: prev?.worktreePath,
        background: prev?.background,
        toolName: prev?.toolName || toolName,
        lastTarget: prev?.lastTarget,
        error: prev?.error,
        startedAt: prev?.startedAt ?? t,
        updatedAt: t,
        endedAt: t,
      };
      this.tasks.set(id, task);
      last = task;
    }
    this.byToolCall.set(toolCallId, ids[0]);
    return last ? { task: last, event: "control" } : null;
  }
}

function isStartLike(update: Record<string, unknown>): boolean {
  const s = str(update.status).toLowerCase();
  return !s || s === "in_progress" || s === "pending" || s === "running";
}

function looksFinished(update: Record<string, unknown>): boolean {
  const blob = JSON.stringify({
    content: update.content,
    rawOutput: update.rawOutput ?? update.raw_output,
    status: update.status,
  }).toLowerCase();
  return (
    blob.includes('"exit_code"') ||
    blob.includes('"completed"') ||
    blob.includes("finished") ||
    blob.includes('"success":true') ||
    blob.includes("subagent completed") ||
    /"status"\s*:\s*"(completed|failed|cancelled)"/.test(blob)
  );
}

/** True if this tool name should enter the multi-agent pipeline at all. */
export function isMultiAgentToolName(name: string): boolean {
  const n = name.toLowerCase();
  if (SUBAGENT_SPAWN.has(n) || SUBAGENT_POLL.has(n) || SUBAGENT_KILL.has(n)) {
    return true;
  }
  if (MONITOR.has(n) || LOOP.has(n)) return true;
  if (BG_SHELL.has(n)) return true;
  if (n.includes("subagent") || n.includes("spawn_agent")) return true;
  return false;
}
