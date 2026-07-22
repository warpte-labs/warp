import * as fs from "fs";
import * as path from "path";
import { grokHome, workspaceCwd } from "./paths";

export type SessionListItem = {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  cwdLabel: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  path: string;
  isWorkspace: boolean;
};

export type HistoryMessage = {
  role: "user" | "assistant" | "system" | "other";
  text: string;
};

/** Lightweight session row for Usage table (summary.json only — no transcripts). */
export type SessionLite = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

/**
 * Cheap session list for Usage — summary.json only, no transcript previews.
 * Avoids the expensive firstUserPreview() walks used by listLocalSessions.
 */
export function listSessionsLite(limit = 80): {
  sessions: number;
  messages: number;
  items: SessionLite[];
} {
  const root = path.join(grokHome(), "sessions");
  const items: SessionLite[] = [];
  let sessions = 0;
  let messages = 0;
  if (!fs.existsSync(root)) {
    return { sessions: 0, messages: 0, items: [] };
  }
  let groups: string[] = [];
  try {
    groups = fs.readdirSync(root);
  } catch {
    return { sessions: 0, messages: 0, items: [] };
  }
  for (const group of groups) {
    if (group === "session_search.sqlite" || group.startsWith(".")) continue;
    const groupPath = path.join(root, group);
    let st: fs.Stats;
    try {
      st = fs.statSync(groupPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let sessionDirs: string[] = [];
    try {
      sessionDirs = fs.readdirSync(groupPath);
    } catch {
      continue;
    }
    for (const sid of sessionDirs) {
      if (sid === "prompt_history.jsonl" || sid.startsWith(".")) continue;
      const summaryPath = path.join(groupPath, sid, "summary.json");
      try {
        if (!fs.existsSync(summaryPath)) continue;
        const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
          info?: { id?: string };
          generated_title?: string;
          session_summary?: string;
          last_active_at?: string;
          updated_at?: string;
          created_at?: string;
          num_chat_messages?: number;
          num_messages?: number;
        };
        const id = String(raw.info?.id || sid);
        const msg = raw.num_chat_messages ?? raw.num_messages ?? 0;
        sessions += 1;
        messages += msg;
        const title =
          String(raw.generated_title || raw.session_summary || "")
            .trim()
            .slice(0, 80) || `Chat ${id.slice(0, 8)}`;
        const updatedAt =
          raw.last_active_at ||
          raw.updated_at ||
          raw.created_at ||
          "";
        items.push({ id, title, updatedAt, messageCount: msg });
      } catch {
        /* skip */
      }
    }
  }
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    sessions,
    messages,
    items: items.slice(0, Math.max(1, limit)),
  };
}

/** @deprecated use listSessionsLite */
export function summarizeLocalSessions(): {
  sessions: number;
  messages: number;
} {
  const s = listSessionsLite(1);
  return { sessions: s.sessions, messages: s.messages };
}

/**
 * List Grok sessions from ~/.grok/sessions (all chats on this machine).
 * Workspace sessions sort first, then by last activity.
 */
export function listLocalSessions(limit = 80): SessionListItem[] {
  const root = path.join(grokHome(), "sessions");
  if (!fs.existsSync(root)) {
    return [];
  }

  const ws = normalizePath(workspaceCwd());
  const items: SessionListItem[] = [];

  let groups: string[] = [];
  try {
    groups = fs.readdirSync(root);
  } catch {
    return [];
  }

  for (const group of groups) {
    if (group === "session_search.sqlite" || group.startsWith(".")) {
      continue;
    }
    const groupPath = path.join(root, group);
    let st: fs.Stats;
    try {
      st = fs.statSync(groupPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }

    let sessionDirs: string[] = [];
    try {
      sessionDirs = fs.readdirSync(groupPath);
    } catch {
      continue;
    }

    for (const sid of sessionDirs) {
      if (sid === "prompt_history.jsonl" || sid.startsWith(".")) {
        continue;
      }
      const sessionPath = path.join(groupPath, sid);
      try {
        if (!fs.statSync(sessionPath).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const summaryPath = path.join(sessionPath, "summary.json");
      if (!fs.existsSync(summaryPath)) {
        continue;
      }

      let summary: {
        info?: { id?: string; cwd?: string };
        session_summary?: string;
        generated_title?: string;
        created_at?: string;
        updated_at?: string;
        last_active_at?: string;
        num_chat_messages?: number;
        num_messages?: number;
      };
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      } catch {
        continue;
      }

      const id = summary.info?.id || sid;
      const cwd = summary.info?.cwd || decodeGroupCwd(group) || "";
      const title =
        (summary.generated_title || summary.session_summary || "").trim() ||
        firstUserPreview(sessionPath) ||
        `Chat ${id.slice(0, 8)}`;
      const updatedAt =
        summary.last_active_at ||
        summary.updated_at ||
        summary.created_at ||
        mtimeIso(sessionPath);
      const createdAt = summary.created_at || updatedAt;
      const preview = firstUserPreview(sessionPath) || title;
      const messageCount =
        summary.num_chat_messages ?? summary.num_messages ?? 0;

      items.push({
        id,
        title: truncate(title, 80),
        preview: truncate(preview, 120),
        cwd,
        cwdLabel: cwdLabel(cwd),
        updatedAt,
        createdAt,
        messageCount,
        path: sessionPath,
        isWorkspace: cwd ? normalizePath(cwd) === ws : false,
      });
    }
  }

  items.sort((a, b) => {
    if (a.isWorkspace !== b.isWorkspace) {
      return a.isWorkspace ? -1 : 1;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  return items.slice(0, limit);
}

/**
 * Rename a session by writing generated_title into summary.json.
 */
export function renameSession(
  sessionId: string,
  title: string
): { ok: boolean; error?: string; title?: string } {
  const clean = title.trim().slice(0, 120);
  if (!clean) {
    return { ok: false, error: "Title is empty" };
  }
  const list = listLocalSessions(500);
  const session = list.find((s) => s.id === sessionId);
  if (!session) {
    return { ok: false, error: "Session not found" };
  }
  const summaryPath = path.join(session.path, "summary.json");
  try {
    const raw = fs.readFileSync(summaryPath, "utf8");
    const summary = JSON.parse(raw) as Record<string, unknown>;
    summary.generated_title = clean;
    summary.updated_at = new Date().toISOString();
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    return { ok: true, title: clean };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Read a readable transcript from chat_history.jsonl (user + assistant only).
 */
export function readSessionTranscript(
  sessionId: string,
  maxMessages = 200
): { session: SessionListItem | null; messages: HistoryMessage[] } {
  const list = listLocalSessions(500);
  const session = list.find((s) => s.id === sessionId) || null;
  if (!session) {
    return { session: null, messages: [] };
  }

  const historyPath = path.join(session.path, "chat_history.jsonl");
  if (!fs.existsSync(historyPath)) {
    return { session, messages: [] };
  }

  const messages: HistoryMessage[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(historyPath, "utf8");
  } catch {
    return { session, messages: [] };
  }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let row: {
      type?: string;
      role?: string;
      content?: unknown;
    };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    const kind = String(row.type || row.role || "").toLowerCase();
    if (kind === "system") {
      continue;
    }
    if (kind !== "user" && kind !== "assistant" && kind !== "tool") {
      // skip tool results / unknown for clean history UI
      if (kind !== "user" && kind !== "assistant") {
        continue;
      }
    }
    if (kind === "tool") {
      continue;
    }

    const text = contentToText(row.content).trim();
    if (!text) {
      continue;
    }
    // Skip huge synthetic compaction blobs in the list view
    if (text.length > 8000 && text.includes("This session is being continued")) {
      continue;
    }

    const role: HistoryMessage["role"] =
      kind === "user" ? "user" : kind === "assistant" ? "assistant" : "other";

    // Prefer the user_query body when present
    const display =
      role === "user" ? extractUserQuery(text) || text : text;

    messages.push({
      role,
      text: truncate(display, 4000),
    });

    if (messages.length >= maxMessages) {
      break;
    }
  }

  return { session, messages };
}

function contentToText(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const p = part as { type?: string; text?: string };
          if (typeof p.text === "string") {
            return p.text;
          }
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object") {
    const o = content as { text?: string };
    if (typeof o.text === "string") {
      return o.text;
    }
  }
  return "";
}

function extractUserQuery(text: string): string {
  const m = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (m?.[1]) {
    return m[1].trim();
  }
  // Strip common wrappers for preview
  if (text.startsWith("<user_info>") || text.startsWith("<system-reminder>")) {
    return "";
  }
  return text;
}

function firstUserPreview(sessionPath: string): string {
  const historyPath = path.join(sessionPath, "chat_history.jsonl");
  if (!fs.existsSync(historyPath)) {
    return "";
  }
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let row: { type?: string; content?: unknown };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(row.type || "").toLowerCase() !== "user") {
        continue;
      }
      const t = extractUserQuery(contentToText(row.content)) || contentToText(row.content);
      const clean = t.replace(/\s+/g, " ").trim();
      if (clean && clean.length > 2 && !clean.startsWith("<")) {
        return clean;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

function decodeGroupCwd(group: string): string {
  try {
    return decodeURIComponent(group);
  } catch {
    return group;
  }
}

function cwdLabel(cwd: string): string {
  if (!cwd) {
    return "";
  }
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function normalizePath(p: string): string {
  try {
    return path.resolve(p).toLowerCase();
  } catch {
    return p.toLowerCase();
  }
}

function mtimeIso(p: string): string {
  try {
    return fs.statSync(p).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function truncate(s: string, n: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) {
    return t;
  }
  return t.slice(0, n - 1) + "…";
}
