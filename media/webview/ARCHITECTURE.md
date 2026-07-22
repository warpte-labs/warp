# Warp webview + host architecture

Modular layout. Prefer adding a small module over growing glue files.

## Host (`src/`)

| Module | Responsibility |
|--------|----------------|
| `extension.ts` | Activate only — wire provider + commands |
| `commands.ts` | VS Code command registration + welcome |
| `config.ts` | **All** settings (secure defaults) |
| `util.ts` | `errMsg`, `delay`, `truncate` |
| `security/paths.ts` | Safe path normalize / resolve / containment |
| `security/permissions.ts` | Tool permission QuickPick + YOLO confirm |
| `webviewProvider.ts` | Webview lifecycle + agent event forward |
| `webviewMessages.ts` | Webview → host message router |
| `webviewHtml.ts` | HTML shell + asset URIs (`assetV` cache-bust) |
| `agentProcess.ts` | Turn orchestration, mock mode, YOLO toggle |
| `acpClient.ts` | ACP transport (stdio JSON-RPC) + task emit |
| `acp/*` | content, prompts, tools, models, clientRequests, **tasks** (multi-agent registry) |
| `sessionHistory.ts` | Local `~/.grok/sessions` list/read |
| `workspaceFiles.ts` | `@` file search |
| `auth.ts` / `paths.ts` | Auth + binary/cwd resolution |

## Webview (`media/webview/js/`)

| Module | Responsibility |
|--------|----------------|
| `util.js` | `escapeHtml`, `formatTok` (shared) |
| `app.js` | Bootstrap only — wire + ready |
| `dom.js` | Element map |
| `composer.js` | Send / queue / slash intercepts / attach |
| `hostBridge.js` | Host → webview message switch |
| `slash.js` | Slash command palette |
| `queue.js` | Prompt queue |
| `compactBar.js` | Compacting row |
| `mention.js` | `@` file picker |
| `attach.js` | Image/file tray |
| `transcript.js` | Turn transcript |
| `tools.js` | Tool rows |
| `agentFill.js` | Radial fill circle (no spin/pulse), per-agent colors |
| `subagents.js` | Multi-agent blocks (reason + steps with fill dots) |
| `hostBridge.js` | `task` / `tasks` → transcript.upsertSubagent |
| `cards.js` | User / think / agent DOM |
| `history.js` | History panel |
| `modelSelector.js` | Model + effort |
| `hero.js` | W logo spiral + stream |
| `markdown.js` | Marked + sanitize + file links |
| `spinner.js` | Think spinner |

## Security rules

1. **`alwaysApprove` defaults false** — ask mode; enabling YOLO requires modal confirm.
2. **Permissions** — `session/request_permission` uses QuickPick unless YOLO.
3. **Writes outside workspace** blocked in ask mode (ACP fs write).
4. **Path helpers** — use `security/paths` for webview-origin paths.
5. **Prompts require sign-in** — host rejects prompt/compact if not authenticated.
6. **CSP** locked in `webviewHtml.ts` (no remote scripts).

## DRY rules

1. **One concern per file.** No UI parsing in `acpClient`; no DOM in host.
2. **Glue stays thin.** `app.js` / `extension.ts` only wire.
3. **Settings only via `config.ts`.**
4. **Errors via `errMsg()`.**
5. **Bump `assetV` in `webviewHtml.ts`** when webview JS/CSS changes.
