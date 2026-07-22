/**
 * ACP session/request_permission — ask / auto / yolo.
 *
 * Aligns with xAI Grok permission policy:
 *  - ask  → prompt (default)
 *  - auto → allow built-in safe/read tools; prompt for write/exec/shell
 *  - yolo → allow everything (agent also runs with --always-approve)
 *
 * @see ~/.grok/docs/user-guide/22-permissions-and-safety.md
 * @see ~/.grok/docs/user-guide/04-slash-commands.md (/auto = classifier for safe tools)
 */
import * as vscode from "vscode";
import type { JsonRpcId, RespondFns } from "../acp/clientRequests";
import { getPermissionMode } from "../config";
import { truncate } from "../util";

export type PermissionOption = {
  optionId: string;
  name?: string;
  kind?: string;
};

/**
 * Handle tool permission prompts.
 * - yolo: auto-select first allow-like option
 * - auto: allow safe/read tools; prompt for write/exec
 * - ask: always QuickPick
 */
export async function handlePermissionRequest(
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): Promise<void> {
  const options = (params.options as PermissionOption[]) || [];
  if (!options.length) {
    io.respond(id, { outcome: { outcome: "cancelled" } });
    return;
  }

  const allowOpt =
    options.find((o) => /allow/i.test(o.kind || "")) ||
    options.find((o) => /allow/i.test(o.name || "")) ||
    options[0];

  const mode = getPermissionMode();

  if (mode === "yolo") {
    io.respond(id, {
      outcome: {
        outcome: "selected",
        optionId: allowOpt.optionId,
      },
    });
    return;
  }

  if (mode === "auto" && isSafeTool(params)) {
    io.respond(id, {
      outcome: {
        outcome: "selected",
        optionId: allowOpt.optionId,
      },
    });
    return;
  }

  const title = permissionTitle(params);
  const picks = options.map((o) => ({
    label: o.name || o.optionId,
    description: o.kind || "",
    optionId: o.optionId,
  }));

  const chosen = await vscode.window.showQuickPick(picks, {
    title: "Warp — tool permission",
    placeHolder: title,
    ignoreFocusOut: true,
  });

  if (!chosen) {
    io.respond(id, { outcome: { outcome: "cancelled" } });
    return;
  }

  io.respond(id, {
    outcome: { outcome: "selected", optionId: chosen.optionId },
  });
}

/**
 * Safe tools for Warp "auto" — mirrors Grok built-in auto-approvals:
 * read_file, list_dir, grep, web_search, todo_write, subagent control, skills.
 * Anything write/exec/shell/network-mutating still prompts.
 */
function isSafeTool(params: Record<string, unknown>): boolean {
  const blob = toolIdentityBlob(params);
  if (!blob) return false;

  // Explicitly risky — never auto
  if (
    /\b(write|edit|create|delete|remove|unlink|rename|move|mkdir|rmdir|truncate|patch|apply|search_replace|str_replace|exec|shell|bash|powershell|cmd|run_terminal|spawn|install|uninstall|rm\b|mv\b|cp\b|chmod|chown|sudo|kill|curl|wget|fetch|http|post|put|patch|network|browser_click|browser_type|send|email|deploy|publish|push)\b/i.test(
      blob
    )
  ) {
    // Allow known-safe web search / read fetch wording that includes "fetch"
    if (
      /\b(web_search|websearch|web.?search|browse.?page|open_page|search_web)\b/i.test(
        blob
      ) &&
      !/\b(write|edit|exec|shell|bash|run_terminal)\b/i.test(blob)
    ) {
      // fall through to safe checks
    } else {
      return false;
    }
  }

  // Grok / Warp read-only style tools
  if (
    /\b(read_file|read|list_dir|list|glob|grep|search|find|stat|ls|cat|head|tail|view|open|inspect|analyze|diff|status|log|get_command|wait_command|kill_command|subagent|todo_write|todo|skill|web_search|websearch|browse|docs?)\b/i.test(
      blob
    )
  ) {
    return true;
  }

  // ACP kind enums sometimes used by clients
  if (
    /^(read|search|list|fetch|other)$/i.test(blob.trim()) ||
    /\bkind[:=]\s*(read|search|list)\b/i.test(blob)
  ) {
    return true;
  }

  return false;
}

/** Flatten toolCall / title / kind / name into one string for matching. */
function toolIdentityBlob(params: Record<string, unknown>): string {
  const toolCall = params.toolCall as Record<string, unknown> | undefined;
  const xai =
    toolCall && typeof toolCall._meta === "object" && toolCall._meta
      ? ((toolCall._meta as Record<string, unknown>).xaiTool as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const parts = [
    toolCall?.title,
    toolCall?.kind,
    toolCall?.toolName,
    toolCall?.name,
    xai?.kind,
    xai?.name,
    xai?.label,
    params.kind,
    params.title,
    params.toolName,
  ];
  return parts
    .filter((p) => typeof p === "string" && p.trim())
    .join(" ")
    .toLowerCase();
}

function permissionTitle(params: Record<string, unknown>): string {
  const toolCall = params.toolCall as Record<string, unknown> | undefined;
  const raw =
    (toolCall &&
      (typeof toolCall.title === "string"
        ? toolCall.title
        : typeof toolCall.kind === "string"
          ? toolCall.kind
          : "")) ||
    (typeof params.title === "string" ? params.title : "") ||
    "Allow this tool action?";
  return truncate(String(raw), 120);
}

/** Confirm enabling YOLO mode (destructive). Returns false if user cancels. */
export async function confirmEnableYolo(): Promise<boolean> {
  const pick = await vscode.window.showWarningMessage(
    "Enable YOLO? The agent can run tools and shell commands without asking. Only use on trusted workspaces.",
    { modal: true },
    "Enable YOLO",
    "Cancel"
  );
  return pick === "Enable YOLO";
}
