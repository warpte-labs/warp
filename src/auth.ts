import * as fs from "fs";
import * as vscode from "vscode";
import { spawn } from "child_process";
import { authJsonPath, resolveBinary } from "./paths";

export type AuthStatus = {
  signedIn: boolean;
  path: string;
  /** Best-effort label from auth file keys / size. */
  detail: string;
};

export function getAuthStatus(): AuthStatus {
  const p = authJsonPath();
  try {
    if (!fs.existsSync(p)) {
      return { signedIn: false, path: p, detail: "No auth.json — not signed in" };
    }
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return { signedIn: false, path: p, detail: "auth.json empty" };
    }
    // Keys look like "https://auth.x.ai::uuid"
    const issuer = keys[0]?.split("::")[0] ?? "account";
    return {
      signedIn: true,
      path: p,
      detail: `Signed in (${issuer})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { signedIn: false, path: p, detail: `auth unreadable: ${msg}` };
  }
}

/**
 * Run `grokfork login` / `grok login` in a VS Code terminal so the browser
 * OAuth / device flow can complete. Polls auth.json until signed in or timeout.
 */
export async function loginWithCli(
  output: vscode.OutputChannel,
  opts?: { deviceAuth?: boolean }
): Promise<AuthStatus> {
  const bin = resolveBinary();
  const args = ["login"];
  if (opts?.deviceAuth) {
    args.push("--device-auth");
  }

  output.appendLine(`[auth] starting: ${bin} ${args.join(" ")}`);

  const term = vscode.window.createTerminal({
    name: "Warp Login",
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
  term.show(true);
  // Quote path if it has spaces
  const q = bin.includes(" ") ? `"${bin}"` : bin;
  term.sendText(`${q} ${args.join(" ")}`, true);

  const before = safeMtime(authJsonPath());
  const status = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Warp: waiting for Grok sign-in…",
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({
        message: "Complete login in the browser / terminal",
      });
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        if (token.isCancellationRequested) {
          break;
        }
        const st = getAuthStatus();
        if (st.signedIn) {
          const mt = safeMtime(authJsonPath());
          // Prefer newly written file, but accept existing valid session
          if (mt !== before || st.signedIn) {
            return st;
          }
        }
        await delay(1000);
      }
      return getAuthStatus();
    }
  );

  if (status.signedIn) {
    void vscode.window.showInformationMessage(`Warp: ${status.detail}`);
    output.appendLine(`[auth] ${status.detail}`);
  } else {
    void vscode.window.showWarningMessage(
      "Warp: still not signed in. Finish login in the Warp Login terminal, then try again."
    );
    output.appendLine("[auth] login timed out or cancelled");
  }
  return status;
}

export async function logoutWithCli(
  output: vscode.OutputChannel
): Promise<void> {
  const bin = resolveBinary();
  output.appendLine(`[auth] logout: ${bin} logout`);

  await new Promise<void>((resolve) => {
    const child = spawn(bin, ["logout"], {
      windowsHide: true,
      env: { ...process.env },
    });
    child.on("error", (err) => {
      output.appendLine(`[auth] logout error: ${err.message}`);
      resolve();
    });
    child.on("exit", (code) => {
      output.appendLine(`[auth] logout exit ${code}`);
      resolve();
    });
  });

  // If logout binary failed, still try removing auth.json for local clear
  const st = getAuthStatus();
  if (st.signedIn) {
    try {
      fs.unlinkSync(authJsonPath());
      output.appendLine("[auth] removed auth.json");
    } catch (e) {
      output.appendLine(`[auth] could not remove auth.json: ${e}`);
    }
  }

  void vscode.window.showInformationMessage("Warp: signed out");
}

function safeMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
