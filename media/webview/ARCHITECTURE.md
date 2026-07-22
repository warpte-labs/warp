# Warp webview + host architecture

Modular layout. Prefer adding a small module over growing glue files.

## Host (`src/`)

| Module | Responsibility |
|--------|----------------|
| `extension.ts` | Activate, commands, auth wiring |
| `webviewProvider.ts` | Webview lifecycle + agent event forward |
| `webviewMessages.ts` | Webview → host message router |
| `webviewHtml.ts` | HTML shell + asset URIs |
| `agentProcess.ts` | Turn orchestration, mock mode |
| `acpClient.ts` | ACP transport (stdio JSON-RPC) |
| `acp/content.ts` | `textFromContent` |
| `acp/promptContent.ts` | Prompt blocks + attachments |
| `acp/toolParse.ts` | Tool UI event parse |
| `acp/models.ts` | Session model state + effort parse |
| `acp/clientRequests.ts` | fs + permission handlers |
| `sessionHistory.ts` | Local `~/.grok/sessions` list/read |
| `workspaceFiles.ts` | `@` file search |
| `auth.ts` / `paths.ts` | Auth + binary/cwd |

## Webview (`media/webview/js/`)

| Module | Responsibility |
|--------|----------------|
| `app.js` | Bootstrap only — wire + ready |
| `dom.js` | Element map |
| `composer.js` | Send / queue / attach / @ |
| `hostBridge.js` | Host → webview message switch |
| `queue.js` | Prompt queue state + compact list |
| `compactBar.js` | Compacting row above composer (soft orange circle) |
| `mention.js` | `@` file picker |
| `attach.js` | Image/file tray |
| `transcript.js` | Turn transcript |
| `tools.js` | Tool rows + orange pulse |
| `cards.js` | User / think / agent DOM |
| `history.js` | History panel |
| `modelSelector.js` | Model + High/Medium/Low effort picker |
| `hero.js` | Empty-state W + molasses stream + trail push-away hover |
| `markdown.js` | Marked + table wrap |
| `spinner.js` | Think circle-trace |

Host model wire: `session/new` → `models`; `session/set_model` + `_meta.reasoningEffort`;
notifications `_x.ai/models/update` / `model_changed`.

## Rules

1. **One concern per file.** No UI parsing in `acpClient`; no DOM in host.
2. **Glue stays thin.** `app.js` and `webviewProvider.ts` only wire.
3. **Share helpers.** Prompt/tool/content live under `src/acp/`.
4. **No status chrome text** unless product asks (`ready`, etc.).
5. **Bump `assetV` in `webviewHtml.ts`** when webview JS/CSS changes.
