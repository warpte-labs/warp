# Warp webview (prod UI)

Scalable, DRY front-end for the Warp side panel.

```
media/webview/
  css/chat.css          # layout + cards + think accordion + markdown
  lib/marked.umd.js     # markdown (sync via npm run sync:marked)
  js/
    markdown.js         # Warp.markdown — sanitize + render
    spinner.js          # Warp.spinner  — Flows circle-trace
    cards.js            # Warp.cards    — user / think / grok factories
    transcript.js       # Warp.Transcript — turn orchestration
    hero.js             # Warp.hero     — empty-state W + molasses stream + trail push-away hover
    app.js              # host bridge (messages in/out)
```

## Host contract

**Webview → extension**

| type | payload |
|------|---------|
| `ready` | — |
| `prompt` | `{ text }` |
| `signIn` / `signOut` | — |

**Extension → webview**

| type | payload |
|------|---------|
| `auth` | `{ signedIn, mock, detail? }` |
| `thought` | `{ text }` delta (markdown) |
| `message` | `{ text }` delta (markdown) |
| `turn` | `{ phase: "start" \| "end" }` |
| `error` | `{ text }` |
| `tool` | optional `{ id, title, status }` |

## Adding UI

1. Prefer a new helper under `js/` registered on `window.Warp`.
2. Keep `app.js` as wiring only.
3. Keep `src/webviewProvider.ts` thin (postMessage bridge only).
