/** Parse ACP tool_call / tool_call_update into UI-friendly rows. */

export type ToolUiEvent = {
  id: string;
  title: string;
  status: string;
  kind: string;
  target: string;
  label: string;
};

/**
 * Prefer paths/commands over opaque call-* ids.
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

  return {
    id,
    title,
    status: status || (isStart ? "in_progress" : "completed"),
    kind,
    target,
    label: title,
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
