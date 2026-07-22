/** Parse ACP tool_call / tool_call_update into UI-friendly rows. */

export type ToolUiEvent = {
  id: string;
  title: string;
  status: string;
  kind: string;
  target: string;
  label: string;
  /** When Grok tags a tool as belonging to a child agent */
  subagentId?: string;
  subagentType?: string;
  /** True when this is spawn_subagent / Task tool (parent-level) */
  isSpawn?: boolean;
};

/**
 * Prefer paths/commands over opaque call-* ids.
 * Also parse Grok subagent titles: `[subagent:explore] Title (id)`.
 */
export function parseToolUpdate(
  update: Record<string, unknown>,
  isStart: boolean
): ToolUiEvent {
  const id = String(update.toolCallId || update.id || "");
  const rawTitle = String(update.title || "").trim();
  const status = String(
    update.status || (isStart ? "in_progress" : "")
  ).trim();

  const meta = update._meta as Record<string, unknown> | undefined;
  const xaiTool = meta?.["x.ai/tool"] as Record<string, unknown> | undefined;
  const rawInput =
    (update.rawInput as Record<string, unknown> | undefined) ||
    (xaiTool?.input as Record<string, unknown> | undefined) ||
    undefined;

  const kind = String(
    update.kind ||
      xaiTool?.kind ||
      xaiTool?.name ||
      rawInput?.variant ||
      ""
  ).trim();

  const label = String(
    xaiTool?.label || xaiTool?.name || rawTitle || kind || "tool"
  ).trim();

  let target = pathFromLocations(update.locations);
  if (!target && rawInput) {
    target = pathFromRawInput(rawInput);
  }
  if (!target && rawTitle) {
    target = pathFromTitle(rawTitle);
  }
  target = shortenPath(target);

  let title = label;
  if (looksLikeToolName(title) && xaiTool?.label) {
    title = String(xaiTool.label);
  }
  if (looksLikeCallId(title)) {
    title = kind && !looksLikeCallId(kind) ? kind : "tool";
  }

  const tagged = parseSubagentTag(rawTitle) || parseSubagentTag(title);
  if (tagged?.cleanTitle) {
    title = tagged.cleanTitle;
  }

  const nameLower = (
    kind +
    " " +
    String(xaiTool?.name || "") +
    " " +
    String(xaiTool?.label || "") +
    " " +
    rawTitle
  ).toLowerCase();
  const inputLooksSpawn = !!(
    rawInput &&
    (typeof rawInput.subagent_type === "string" ||
      typeof rawInput.subagentType === "string" ||
      (typeof rawInput.prompt === "string" &&
        typeof rawInput.description === "string" &&
        String(rawInput.prompt).length > 20))
  );
  const isSpawn =
    nameLower.includes("spawn_subagent") ||
    nameLower.includes("spawn_agent") ||
    /\btask_tool\b/.test(nameLower) ||
    (nameLower.includes("subagent") && nameLower.includes("spawn")) ||
    inputLooksSpawn;

  let subagentId =
    tagged?.id ||
    (typeof rawInput?.subagent_id === "string"
      ? rawInput.subagent_id
      : undefined) ||
    (typeof rawInput?.task_id === "string" ? rawInput.task_id : undefined);
  let subagentType =
    tagged?.type ||
    (typeof rawInput?.subagent_type === "string"
      ? rawInput.subagent_type
      : undefined);

  // Spawn description often is the human title
  if (isSpawn && rawInput && typeof rawInput.description === "string") {
    title = rawInput.description.trim() || title;
  }

  // Poll / wait / kill background task — never leave title as bare "tool"
  const pollLike =
    nameLower.includes("get_command_or_subagent") ||
    nameLower.includes("get_task_output") ||
    nameLower.includes("task output") ||
    nameLower.includes("wait_command") ||
    nameLower.includes("wait_task") ||
    /background\s*task/i.test(rawTitle) ||
    /get task output/i.test(rawTitle);
  if (pollLike) {
    const tid =
      subagentId ||
      (typeof rawInput?.task_id === "string" ? rawInput.task_id : "") ||
      (typeof rawInput?.taskId === "string" ? rawInput.taskId : "") ||
      extractIdFromTitle(rawTitle);
    title = tid
      ? `Checking agent ${String(tid).slice(0, 8)}…`
      : "Checking agents…";
    if (!target && tid) target = String(tid).slice(0, 8);
  }

  // ACP sometimes sends kind/title literally "tool"
  if (!title || title.toLowerCase() === "tool" || looksLikeCallId(title)) {
    if (target) title = target;
    else if (kind && kind.toLowerCase() !== "tool") title = kind;
    else title = isStart ? "Working…" : "Done";
  }

  return {
    id,
    title,
    status: status || (isStart ? "in_progress" : "completed"),
    kind: pollLike ? "get_command_or_subagent_output" : kind,
    target,
    label: title,
    subagentId: subagentId || undefined,
    subagentType: subagentType || undefined,
    isSpawn: isSpawn || undefined,
  };
}

function extractIdFromTitle(title: string): string {
  const m = String(title || "").match(
    /([0-9a-f]{8}-[0-9a-f-]{20,}|[0-9a-f]{8,})/i
  );
  return m?.[1] || "";
}

/**
 * Grok titles: `[subagent:explore] Explore codebase structure (019f8b30)`
 */
export function parseSubagentTag(text: string): {
  type?: string;
  id?: string;
  cleanTitle: string;
} | null {
  const s = String(text || "").trim();
  if (!s) return null;
  const m = s.match(
    /^\[subagent:([^\]]+)\]\s*(.*?)\s*(?:\(([0-9a-f-]{8,})\))?\s*$/i
  );
  if (!m) {
    // Also match mid-string tags
    const m2 = s.match(
      /\[subagent:([^\]]+)\]\s*([^(\n]*?)(?:\(([0-9a-f-]{8,})\))?/i
    );
    if (!m2) return null;
    return {
      type: m2[1]?.trim() || undefined,
      id: m2[3]?.trim() || undefined,
      cleanTitle: (m2[2] || "").trim() || s,
    };
  }
  return {
    type: m[1]?.trim() || undefined,
    id: m[3]?.trim() || undefined,
    cleanTitle: (m[2] || "").trim() || s,
  };
}

function pathFromLocations(locations: unknown): string {
  if (!Array.isArray(locations) || !locations.length) {
    return "";
  }
  const first = locations[0] as Record<string, unknown>;
  return typeof first?.path === "string" ? first.path : "";
}

function pathFromRawInput(rawInput: Record<string, unknown>): string {
  const candidates = [
    rawInput.target_file,
    rawInput.path,
    rawInput.file_path,
    rawInput.filePath,
    rawInput.command,
    rawInput.pattern,
    rawInput.query,
    rawInput.glob,
    rawInput.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return c.trim();
    }
  }
  if (typeof rawInput.description === "string") {
    return rawInput.description.trim();
  }
  return "";
}

function pathFromTitle(rawTitle: string): string {
  const m = rawTitle.match(/`([^`]+)`/);
  if (m?.[1]) {
    return m[1];
  }
  if (!looksLikeToolName(rawTitle) && !looksLikeCallId(rawTitle)) {
    return rawTitle;
  }
  return "";
}

function looksLikeCallId(s: string): boolean {
  return /^call-[0-9a-f-]+/i.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{20,}/i.test(s);
}

function looksLikeToolName(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(s) && s.includes("_");
}

function shortenPath(p: string): string {
  if (!p) {
    return "";
  }
  const norm = p.replace(/\\/g, "/");
  if (norm.length > 64 && (norm.includes("/") || p.includes("\\"))) {
    const parts = norm.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(-2).join("/");
    }
  }
  if (p.length > 72) {
    return p.slice(0, 69) + "…";
  }
  return p;
}
