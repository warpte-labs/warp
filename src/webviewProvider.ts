import * as vscode from "vscode";
import { AgentProcess } from "./agentProcess";
import type { AuthStatus } from "./auth";
import { handleWebviewMessage } from "./webviewMessages";
import { buildChatHtml } from "./webviewHtml";

/**
 * Host bridge: VS Code webview ↔ AgentProcess.
 * Message routing lives in webviewMessages.ts.
 */
export class WarpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "warp.chat";

  private view?: vscode.WebviewView;
  private uiCommandHandler?: (cmd: string) => void | Promise<void>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: AgentProcess,
    private readonly getAuth: () => AuthStatus,
    private readonly log?: (line: string) => void
  ) {
    this.wireAgent();
  }

  private wireAgent(): void {
    this.agent.on("thought", (p: { text: string }) => {
      this.log?.(`[acp] thought +${(p.text || "").length} chars`);
      this.post({ type: "thought", text: p.text ?? "" });
    });
    this.agent.on("message", (p: { text: string }) => {
      this.log?.(`[acp] message +${(p.text || "").length} chars`);
      this.post({ type: "message", text: p.text ?? "" });
    });
    this.agent.on("turn", (p: { phase: string }) => {
      this.log?.(`[acp] turn ${p.phase}`);
      this.post({ type: "turn", phase: p.phase });
    });
    this.agent.on("error", (text: string) => {
      this.log?.(`[acp] error ${text}`);
      this.post({ type: "error", text });
    });
    this.agent.on("status", (text: string) => {
      this.log?.(`[acp] status ${text}`);
    });
    this.agent.on("tool", (p: unknown) => {
      this.log?.(`[acp] tool ${JSON.stringify(p)}`);
      this.post({ type: "tool", ...(p as object) });
    });
    this.agent.on("models", (p: object) => {
      this.log?.(
        `[acp] models ${JSON.stringify({
          currentModelId: (p as { currentModelId?: string }).currentModelId,
          reasoningEffort: (p as { reasoningEffort?: string }).reasoningEffort,
        })}`
      );
      this.post({ type: "models", ...p });
    });
    this.agent.on("context", (p: object) => {
      this.post({ type: "context", ...p });
    });
    this.agent.on("compact", (p: object) => {
      this.log?.(`[acp] compact ${JSON.stringify(p)}`);
      this.post({ type: "compact", ...p });
    });
    this.agent.on("commands", (p: { commands?: unknown[] }) => {
      const n = Array.isArray(p?.commands) ? p.commands.length : 0;
      this.log?.(`[acp] commands ${n}`);
      this.post({ type: "commands", commands: p?.commands || [] });
    });
    this.agent.on("permissionMode", (p: { alwaysApprove?: boolean }) => {
      this.post({
        type: "permissionMode",
        alwaysApprove: !!p?.alwaysApprove,
      });
    });
    this.agent.on("ready", (p: unknown) => {
      const rec = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      if (rec.models && typeof rec.models === "object") {
        this.post({ type: "models", ...(rec.models as object) });
      }
      const ctx = this.agent.getContextUsage();
      this.post({ type: "context", ...ctx });
      const cmds = this.agent.getAvailableCommands();
      if (cmds.length) {
        this.post({ type: "commands", commands: cmds });
      }
      this.post({
        type: "permissionMode",
        alwaysApprove: this.agent.getAlwaysApprove(),
      });
    });
  }

  onUiCommand(handler: (cmd: string) => void | Promise<void>): void {
    this.uiCommandHandler = handler;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    const folder =
      vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace";
    webviewView.webview.html = buildChatHtml(
      webviewView.webview,
      this.extensionUri,
      folder
    );

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") {
        return;
      }
      await handleWebviewMessage(msg as Record<string, unknown>, {
        agent: this.agent,
        post: (m) => this.post(m),
        log: this.log,
        uiCommand: this.uiCommandHandler,
        pushAuthStatus: () => this.pushAuthStatus(),
      });
    });
  }

  postStatus(text: string): void {
    this.post({ type: "status", text });
  }

  pushAuthStatus(): void {
    const auth = this.getAuth();
    const mock = vscode.workspace
      .getConfiguration("warp")
      .get<boolean>("mockMode", false);
    this.post({
      type: "auth",
      signedIn: auth.signedIn,
      detail: auth.detail,
      mock,
    });
  }

  reveal(): boolean {
    if (!this.view) {
      return false;
    }
    this.view.show?.(true);
    return true;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }
}
