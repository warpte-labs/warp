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
  // Cache-bust local assets so Cursor/VS Code picks up CSS/JS on each release
  const assetV = "0.8.1";
  const asset = (...parts: string[]) => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, ...parts)
    );
    return `${uri.toString()}?v=${assetV}`;
  };
  const cssUri = asset("media", "webview", "css", "chat.css");
  const markedUri = asset("media", "webview", "lib", "marked.umd.js");
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
  <div class="chat">
    <div class="chat-top">
      <span class="powered" id="powered">powered by grok</span>
      <div class="chat-top-right">
        <button type="button" class="top-ico" id="btn-new-chat" title="New conversation" aria-label="New conversation">${iconNewChat()}</button>
        <button type="button" class="top-ico" id="btn-history" title="Chat history" aria-label="Chat history">${iconHistory()}</button>
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
        <div class="sb">
          <div class="tray" id="tray"></div>
          <div class="sb-input">
            <textarea id="input" rows="1" placeholder="Message Grok… · image or + for files"></textarea>
          </div>
          <div class="sb-bar">
            <button type="button" class="ico on" id="btn-plus" title="Attach file">${iconPlus()}</button>
            <button type="button" class="ico" id="btn-at" title="Mention file (@)">${iconAt()}</button>
            <button type="button" class="ico" id="btn-slash" title="Slash command">${iconSlash()}</button>
            <button type="button" class="ico" id="btn-image" title="Attach image">${iconImage()}</button>
            <span class="spacer"></span>
            <button type="button" class="meta meta-btn" id="meta" title="Model &amp; effort">Grok 4.5</button>
            <button type="button" class="send" id="send" title="send">${iconSend()}</button>
          </div>
        </div>
        <div class="footer-row">
          <span class="ctx-usage" id="ctx-usage" title="Context window usage">—</span>
          <button type="button" class="perm-chip yolo" id="perm-chip" title="Tool permission mode">yolo</button>
          <button type="button" id="btn-auth">Sign in</button>
        </div>
        <div class="toast" id="toast" hidden></div>
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
  </div>

  <input id="file-image" class="hidden-file" type="file" accept="image/*" multiple />
  <input id="file-any" class="hidden-file" type="file" multiple />

  <script type="application/json" id="warp-tiles-data">${tilesJson}</script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${script("dom.js")}"></script>
  <script nonce="${nonce}" src="${script("markdown.js")}"></script>
  <script nonce="${nonce}" src="${script("spinner.js")}"></script>
  <script nonce="${nonce}" src="${script("cards.js")}"></script>
  <script nonce="${nonce}" src="${script("tools.js")}"></script>
  <script nonce="${nonce}" src="${script("transcript.js")}"></script>
  <script nonce="${nonce}" src="${script("hero.js")}"></script>
  <script nonce="${nonce}" src="${script("history.js")}"></script>
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

function iconNewChat(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>`;
}
function iconHistory(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8v4l3 2"/></svg>`;
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
