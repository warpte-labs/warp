/**
 * Safe path resolution for host I/O (open/attach/fs).
 * Prevents trivial path tricks from the webview and normalizes file URIs.
 */
import * as fs from "fs";
import * as path from "path";
import { workspaceCwd } from "../paths";

export type ResolvePathOpts = {
  /** If true, path must resolve under workspaceCwd() (or workspace folders). */
  mustBeUnderWorkspace?: boolean;
  /** Allow absolute paths outside workspace (user-picked files, agent tools). */
  allowAbsoluteOutside?: boolean;
};

/**
 * Normalize a path coming from webview / ACP (file://, quotes, mixed slashes).
 */
export function normalizeIncomingPath(raw: string): string {
  let filePath = String(raw || "").trim();
  if (!filePath) return "";
  filePath = filePath.replace(/^['"`]+|['"`]+$/g, "");
  // file:///C:/Users/... or file://localhost/C:/...
  if (/^file:/i.test(filePath)) {
    try {
      const u = new URL(filePath);
      filePath = decodeURIComponent(u.pathname || "");
    } catch {
      filePath = filePath.replace(/^file:\/\/\/?/i, "");
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        /* keep */
      }
    }
  }
  // Windows file URL pathname: /C:/Users/...
  if (/^\/[A-Za-z]:[\\/]/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  // Prefer native separators
  if (process.platform === "win32") {
    filePath = filePath.replace(/\//g, path.sep);
  } else {
    filePath = filePath.replace(/\\/g, path.sep);
  }
  return filePath;
}

/**
 * Resolve to an absolute path. Optionally require workspace containment.
 * Returns null if empty, missing, or escapes workspace when required.
 */
export function resolveSafePath(
  raw: string,
  opts: ResolvePathOpts = {}
): string | null {
  const normalized = normalizeIncomingPath(raw);
  if (!normalized) return null;

  const cwd = workspaceCwd();
  let abs = path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.normalize(path.resolve(cwd, normalized));

  // Resolve .. segments
  abs = path.resolve(abs);

  if (opts.mustBeUnderWorkspace) {
    if (!isPathInside(abs, cwd) && !isInsideAnyWorkspaceFolder(abs)) {
      return null;
    }
  }

  return abs;
}

export function isPathInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isInsideAnyWorkspaceFolder(abs: string): boolean {
  try {
    // Lazy require to keep this module usable in tests without vscode mock
    const vscode = require("vscode") as typeof import("vscode");
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.some((f) => isPathInside(abs, f.uri.fsPath));
  } catch {
    return false;
  }
}

/** Binary path must exist and be a regular file (not a directory). */
export function assertExecutablePath(bin: string): string | null {
  const p = String(bin || "").trim();
  if (!p) return null;
  // Bare command names (PATH) are allowed — spawn will resolve
  if (!p.includes(path.sep) && !p.includes("/") && !/^[A-Za-z]:/.test(p)) {
    return p;
  }
  try {
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    return p;
  } catch {
    return null;
  }
}
