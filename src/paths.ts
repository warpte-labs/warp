import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import * as vscode from "vscode";

/** Grok home directory (~/.grok or %USERPROFILE%\.grok). */
export function grokHome(): string {
  if (process.env.GROK_HOME) {
    return process.env.GROK_HOME;
  }
  return path.join(os.homedir(), ".grok");
}

export function authJsonPath(): string {
  return path.join(grokHome(), "auth.json");
}

/**
 * Resolve the agent/CLI binary. Preference order:
 * 1. warp.binaryPath setting (if the path exists, or as-is when user forced a name)
 * 2. Known install locations under the user home
 * 3. `grokfork` / `grok` found on PATH
 * 4. Fallback bare name `grok` (lets spawn report a clear ENOENT)
 */
export function resolveBinary(): string {
  const configured = vscode.workspace
    .getConfiguration("warp")
    .get<string>("binaryPath", "")
    ?.trim();
  if (configured) {
    if (fs.existsSync(configured) || !path.isAbsolute(configured)) {
      return configured;
    }
    // Absolute path that does not exist — still return so errors name it
    return configured;
  }

  const home = os.homedir();
  const isWin = process.platform === "win32";
  const candidates = [
    path.join(home, "bin", isWin ? "grokfork.exe" : "grokfork"),
    path.join(home, "bin", isWin ? "grok.exe" : "grok"),
    path.join(home, ".grok", "bin", isWin ? "grok.exe" : "grok"),
    path.join(home, ".grok", "bin", isWin ? "grokfork.exe" : "grokfork"),
    path.join(home, ".local", "bin", "grok"),
    path.join(home, ".local", "bin", "grokfork"),
    // macOS app-ish / common cargo-style paths
    path.join(home, ".cargo", "bin", "grok"),
    path.join(home, ".cargo", "bin", "grokfork"),
    "/usr/local/bin/grok",
    "/usr/local/bin/grokfork",
    "/opt/homebrew/bin/grok",
    "/opt/homebrew/bin/grokfork",
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && isExecutableish(c)) {
        return c;
      }
    } catch {
      /* ignore */
    }
  }

  const onPath = whichOnPath(["grokfork", "grok"]);
  if (onPath) {
    return onPath;
  }

  return isWin ? "grok.exe" : "grok";
}

/** True if resolveBinary() points at a file that currently exists (or a PATH name we found). */
export function binaryLooksAvailable(bin?: string): boolean {
  const b = bin || resolveBinary();
  if (path.isAbsolute(b) || b.includes(path.sep) || b.includes("/")) {
    try {
      return fs.existsSync(b);
    } catch {
      return false;
    }
  }
  return !!whichOnPath([b.replace(/\.exe$/i, ""), b]);
}

function isExecutableish(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    // On Windows, existence is enough; on Unix check any execute bit.
    if (process.platform === "win32") return true;
    return (st.mode & 0o111) !== 0 || true; // still allow non-exec if user will fix
  } catch {
    return false;
  }
}

function whichOnPath(names: string[]): string | null {
  for (const name of names) {
    try {
      if (process.platform === "win32") {
        const out = execSync(`where ${name}`, {
          encoding: "utf8",
          windowsHide: true,
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)[0];
        if (out && fs.existsSync(out)) return out;
      } else {
        const out = execSync(`command -v ${name}`, {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (out && fs.existsSync(out)) return out;
      }
    } catch {
      /* not on PATH */
    }
  }
  return null;
}

export function workspaceCwd(): string {
  return (
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  );
}

/** Human help when the agent binary is missing. */
export function missingBinaryHelp(bin: string): string {
  return [
    `Warp could not start the Grok agent binary: "${bin}".`,
    "",
    "Install Grok Build / Grok CLI (or grokfork), then either:",
    "  • Put `grok` or `grokfork` on your PATH, or",
    "  • Set Settings → Warp: Binary Path to the full executable path.",
    "",
    "Docs: https://docs.x.ai/build/overview",
  ].join("\n");
}
