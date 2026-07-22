import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { WARP_W_TILES } from "./warpWTiles";

/**
 * Builds the Warp chat webview HTML shell.
 * All interactive logic lives in media/webview/js/* (loaded as local resources).
 */
export function buildChatHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  folderName: string
): string {
  const nonce = getNonce();
  // Cache-bust CSS/JS from package version so hotfixes land after Reload Window
  const assetV = readExtensionVersion(extensionUri);
  const asset = (...parts: string[]) => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, ...parts)
    );
    return `${uri.toString()}?v=${assetV}`;
  };
  const cssUri = asset("media", "webview", "css", "chat.css");
  const markedUri = asset("media", "webview", "lib", "marked.umd.js");
  const echartsUri = asset("media", "webview", "lib", "echarts.min.js");
  const script = (name: string) => asset("media", "webview", "js", name);

  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource} data:`,
  ].join("; ");

  void folderName; // reserved if we re-surface workspace label later
  const tilesJson = JSON.stringify(WARP_W_TILES);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Warp</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <div class="chat is-signed-out" id="chat-root">
    <div class="chat-top" id="chat-top">
      <span class="powered" id="powered">powered by grok</span>
      <div class="chat-top-right">
        <button type="button" class="top-ico" id="btn-new-chat" data-mode="new" title="New conversation" aria-label="New conversation">${iconNewChat()}</button>
        <button type="button" class="top-ico" id="btn-history" title="Chat history" aria-label="Chat history">${iconHistory()}</button>
        <button type="button" class="top-ico" id="btn-settings" title="Settings" aria-label="Settings">${iconSettings()}</button>
      </div>
    </div>

    <!-- Signed-out gate: no chrome · smaller W · tagline · Continue with Grok -->
    <div class="auth-gate" id="auth-gate" aria-label="Sign in">
      <div class="auth-gate-stack">
        <div class="hero hero-gate" id="hero-gate"></div>
        <p class="auth-gate-tagline">Sign in to chat with Grok in the sidebar</p>
        <button type="button" class="auth-gate-link" id="btn-continue-grok">Continue with Grok</button>
      </div>
    </div>

    <div class="chat-body" id="chat-body">
      <div class="messages-wrap">
        <div class="hero" id="hero"></div>
        <div class="scroll" id="messages"></div>
        <div class="img-viewer" id="img-viewer" hidden>
          <button type="button" class="viewer-close" data-viewer-close aria-label="Close">×</button>
          <img data-viewer-img alt="" />
          <div class="viewer-name" data-viewer-name></div>
        </div>
      </div>

      <div class="composer-slot" style="position:relative">
        <div class="compact-bar" id="compact-bar" hidden></div>
        <div class="prompt-queue" id="prompt-queue" hidden></div>
        <!-- Free trial expired — sits above the message input -->
        <div class="license-bar" id="license-bar" hidden>
          <div class="license-bar-text" id="license-bar-text">Free trial expired. Upgrade to Pro ($5/mo) to keep chatting.</div>
          <button type="button" class="license-bar-btn" id="license-bar-upgrade">Upgrade</button>
        </div>
        <div class="sb">
          <div class="tray" id="tray"></div>
          <div class="sb-input">
            <div class="input-hl" id="input-hl" aria-hidden="true"></div>
            <textarea id="input" rows="1" placeholder="Message Grok… · image or + for files" spellcheck="false"></textarea>
          </div>
          <div class="sb-bar">
            <button type="button" class="ico on" id="btn-plus" title="Attach file">${iconPlus()}</button>
            <button type="button" class="ico" id="btn-at" title="Mention file (@)">${iconAt()}</button>
            <button type="button" class="ico" id="btn-slash" title="Slash command">${iconSlash()}</button>
            <button type="button" class="ico" id="btn-image" title="Attach image">${iconImage()}</button>
            <span class="spacer"></span>
            <button type="button" class="meta meta-btn mode-ask" id="meta" title="Model, effort &amp; tools">Grok 4.5 · High · ask</button>
            <button type="button" class="send" id="send" title="send">${iconSend()}</button>
          </div>
        </div>
        <div class="footer-row">
          <span class="ctx-usage" id="ctx-usage" title="Context window usage">
            <span class="ctx-seg">—</span>
          </span>
          <button type="button" id="btn-auth">Sign in</button>
        </div>
      </div>
    </div>

    <!-- History tab: full list of local Grok sessions -->
    <div class="history-panel hidden" id="history-panel" aria-hidden="true">
      <div class="history-hd">
        <button type="button" class="hist-back" id="btn-history-back" title="Back">← Back</button>
        <span class="history-title" id="history-title">Chat history</span>
        <button type="button" class="hist-refresh" id="btn-history-refresh" title="Refresh">↻</button>
      </div>
      <div class="history-list" id="history-list"></div>
      <div class="history-detail hidden" id="history-detail">
        <div class="history-detail-scroll" id="history-detail-body"></div>
      </div>
    </div>

    <!-- Settings tab -->
    <div class="settings-panel hidden" id="settings-panel" aria-hidden="true">
      <div class="history-hd">
        <button type="button" class="hist-back" id="btn-settings-back" title="Back">← Back</button>
        <span class="history-title" id="settings-title">Settings</span>
        <span class="hist-refresh" aria-hidden="true"></span>
      </div>
      <div class="settings-body" id="settings-list"></div>
    </div>

    <!-- Global toast — sticky until dismissed (X) -->
    <div class="toast" id="toast" hidden role="status">
      <span class="toast-text" id="toast-text"></span>
      <button type="button" class="toast-close" id="toast-close" aria-label="Dismiss">×</button>
    </div>
  </div>

  <input id="file-image" class="hidden-file" type="file" accept="image/*" multiple />
  <input id="file-any" class="hidden-file" type="file" multiple />

  <script type="application/json" id="warp-tiles-data">${tilesJson}</script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${echartsUri}"></script>
  <script nonce="${nonce}" src="${script("util.js")}"></script>
  <script nonce="${nonce}" src="${script("dom.js")}"></script>
  <script nonce="${nonce}" src="${script("markdown.js")}"></script>
  <script nonce="${nonce}" src="${script("spinner.js")}"></script>
  <script nonce="${nonce}" src="${script("agentFill.js")}"></script>
  <script nonce="${nonce}" src="${script("cards.js")}"></script>
  <script nonce="${nonce}" src="${script("tools.js")}"></script>
  <script nonce="${nonce}" src="${script("subagents.js")}"></script>
  <script nonce="${nonce}" src="${script("transcript.js")}"></script>
  <script nonce="${nonce}" src="${script("hero.js")}"></script>
  <script nonce="${nonce}" src="${script("history.js")}"></script>
  <script nonce="${nonce}" src="${script("usage.js")}"></script>
  <script nonce="${nonce}" src="${script("settings.js")}"></script>
  <script nonce="${nonce}" src="${script("attach.js")}"></script>
  <script nonce="${nonce}" src="${script("mention.js")}"></script>
  <script nonce="${nonce}" src="${script("slash.js")}"></script>
  <script nonce="${nonce}" src="${script("queue.js")}"></script>
  <script nonce="${nonce}" src="${script("compactBar.js")}"></script>
  <script nonce="${nonce}" src="${script("modelSelector.js")}"></script>
  <script nonce="${nonce}" src="${script("composer.js")}"></script>
  <script nonce="${nonce}" src="${script("hostBridge.js")}"></script>
  <script nonce="${nonce}" src="${script("app.js")}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** package.json version — used as ?v= for CSS/JS so reloads pick up assets. */
function readExtensionVersion(extensionUri: vscode.Uri): string {
  try {
    const raw = fs.readFileSync(
      path.join(extensionUri.fsPath, "package.json"),
      "utf8"
    );
    const v = JSON.parse(raw)?.version;
    return typeof v === "string" && v ? v : String(Date.now());
  } catch {
    return String(Date.now());
  }
}

/** Plus — new conversation (shown on chat view). */
function iconNewChat(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>`;
}
/** Chat bubble — back to chat (shown on Settings / History). */
function iconBackToChat(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="1.5" d="M12 22c5.5228 0 10-4.4772 10-10 0-5.52285-4.4772-10-10-10C6.47715 2 2 6.47715 2 12c0 1.5997.37562 3.1116 1.04346 4.4525.17748.3563.23655.7636.13366 1.1481l-.59561 2.2261c-.25856.9663.6255 1.8503 1.59184 1.5918l2.22604-.5956c.38454-.1029.79182-.0438 1.14814.1336C8.88837 21.6244 10.4003 22 12 22Z"/></svg>`;
}
function iconHistory(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8v4l3 2"/></svg>`;
}
function iconSettings(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.6.87 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/></svg>`;
}
function iconPlus(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>`;
}
function iconAt(): string {
  // Same @ glyph as grokfork_composer_variants.html
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7.99987v5.00003c0 .7956.3161 1.5587.8787 2.1213s1.3257.8787 2.1213.8787c.7957 0 1.5587-.3161 2.1213-.8787S22 13.7955 22 12.9999v-1c-.0001-2.257-.7638-4.44755-2.1667-6.2155-1.403-1.76795-3.3627-3.00931-5.5607-3.52223-2.1979-.51293-4.50466-.26726-6.54524.69706-2.04059.96433-3.69495 2.59059-4.69409 4.61436S1.74898 11.8996 2.22418 14.106s1.68281 4.1871 3.42646 5.6201c1.74365 1.4331 3.9208 2.2341 6.17746 2.2729 2.2566.0388 4.46-.6869 6.2519-2.0591m-2.08-7.94c0 2.2091-1.7908 4-4 4-2.20913 0-3.99999-1.7909-3.99999-4 0-2.20917 1.79086-4.00003 3.99999-4.00003 2.2092 0 4 1.79086 4 4.00003"/></svg>`;
}
function iconSlash(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M9.5 4.5 14.5 19.5"/></svg>`;
}
function iconImage(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 16 5-5 4 4 5-6"/><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/></svg>`;
}
function iconSend(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>`;
}
