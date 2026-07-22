/**
 * VS Code command registration — keeps extension.ts thin.
 */
import * as vscode from "vscode";
import type { AgentProcess } from "./agentProcess";
import type { WarpViewProvider } from "./webviewProvider";
import { loginWithCli, logoutWithCli } from "./auth";
import { binaryLooksAvailable, resolveBinary } from "./paths";
import { errMsg } from "./util";

export type CommandDeps = {
  context: vscode.ExtensionContext;
  agent: AgentProcess;
  provider: WarpViewProvider;
  log: (line: string) => void;
  output: vscode.OutputChannel;
};

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { agent, provider, log, output } = deps;

  return [
    vscode.commands.registerCommand("warp.open", async () => {
      await openRightSidebar(provider);
    }),
    vscode.commands.registerCommand("warp.restartAgent", async () => {
      try {
        await agent.restart();
        provider.postStatus("Agent restarted");
        provider.pushAuthStatus();
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Warp restart failed: ${errMsg(e)}`
        );
      }
    }),
    vscode.commands.registerCommand("warp.signIn", async () => {
      await runSignIn(deps);
    }),
    vscode.commands.registerCommand("warp.signOut", async () => {
      agent.stop();
      await logoutWithCli(output);
      provider.pushAuthStatus();
    }),
  ];
}

async function runSignIn(deps: CommandDeps): Promise<void> {
  const { agent, provider, log, output } = deps;

  if (!binaryLooksAvailable()) {
    const bin = resolveBinary();
    const pick = await vscode.window.showErrorMessage(
      `Grok agent binary not found ("${bin}"). Install Grok Build / grokfork and set Warp: Binary Path if needed.`,
      "Open Settings",
      "Open Docs"
    );
    if (pick === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "warp.binaryPath"
      );
    } else if (pick === "Open Docs") {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://docs.x.ai/build/overview")
      );
    }
    return;
  }

  const device = await vscode.window.showQuickPick(
    [
      {
        label: "Browser OAuth (auth.x.ai)",
        description: "Default — same as Grok Build TUI",
        device: false,
      },
      {
        label: "Device code",
        description: "Headless / remote environments",
        device: true,
      },
    ],
    { placeHolder: "How do you want to sign in to Grok?" }
  );
  if (!device) return;

  await loginWithCli(output, { deviceAuth: device.device });
  provider.pushAuthStatus();
  try {
    await agent.ensureStarted();
    provider.postStatus("Live agent ready");
  } catch (e) {
    log(`post-login agent start: ${e}`);
  }
}

export async function openRightSidebar(
  provider: WarpViewProvider
): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
  } catch {
    /* ignore */
  }
  for (const cmd of ["workbench.view.extension.warp", "warp.chat.focus"]) {
    try {
      await vscode.commands.executeCommand(cmd);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 100));
  provider.reveal();
  provider.pushAuthStatus();
}

export async function maybeWelcome(
  context: vscode.ExtensionContext,
  provider: WarpViewProvider,
  signedIn: boolean
): Promise<void> {
  const key = "warp.welcomed.v1";
  if (context.globalState.get(key)) return;
  await context.globalState.update(key, true);

  if (!binaryLooksAvailable()) {
    const c = await vscode.window.showInformationMessage(
      "Warp installed. Install the Grok CLI (or grokfork), then set Binary Path if it is not on PATH.",
      "Open Settings",
      "Open Chat"
    );
    if (c === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "warp.binaryPath"
      );
    } else if (c === "Open Chat") {
      await openRightSidebar(provider);
    }
    return;
  }

  if (!signedIn) {
    const c = await vscode.window.showInformationMessage(
      "Warp is ready. Sign in with your Grok account to chat.",
      "Sign In",
      "Open Chat"
    );
    if (c === "Sign In") {
      await vscode.commands.executeCommand("warp.signIn");
    } else if (c === "Open Chat") {
      await openRightSidebar(provider);
    }
  }
}

