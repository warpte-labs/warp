import * as vscode from "vscode";
import { WarpViewProvider } from "./webviewProvider";
import { AgentProcess } from "./agentProcess";
import { getAuthStatus } from "./auth";
import { resolveBinary, binaryLooksAvailable } from "./paths";
import {
  registerCommands,
  maybeWelcome,
} from "./commands";
import { initLicense, getLicenseStatusLocal } from "./license";

let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Warp");
  const log = (msg: string) => {
    output?.appendLine(`[${new Date().toISOString()}] ${msg}`);
  };
  log("activate() starting");

  initLicense(context);
  const plan = getLicenseStatusLocal();
  log(`license: ${plan.kind} — ${plan.detail}`);

  const agent = new AgentProcess();
  const provider = new WarpViewProvider(
    context.extensionUri,
    agent,
    () => getAuthStatus(),
    log
  );

  const cmds = registerCommands({
    context,
    agent,
    provider,
    log,
    output,
  });

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider("warp.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    ...cmds,
    agent
  );

  provider.onUiCommand(async (cmd) => {
    if (cmd === "signIn") {
      await vscode.commands.executeCommand("warp.signIn");
    } else if (cmd === "signOut") {
      await vscode.commands.executeCommand("warp.signOut");
    }
  });

  const auth = getAuthStatus();
  log(auth.detail);
  log(`binary: ${resolveBinary()} available=${binaryLooksAvailable()}`);
  log("activate() complete");

  void maybeWelcome(context, provider, auth.signedIn);
}

export function deactivate() {
  output?.appendLine(`[${new Date().toISOString()}] deactivate()`);
}
