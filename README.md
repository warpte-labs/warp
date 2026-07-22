# Warp

**Warp** is a secondary-sidebar coding agent for **VS Code** and **Cursor**.  
It talks to the [Grok Build](https://docs.x.ai/build/overview) / Grok CLI agent over **ACP** (stdio), with chat UI, tools, slash commands, and your existing Grok account.

## Features

- Chat in the **right secondary sidebar**
- **Grok OAuth** sign-in (same `~/.grok/auth.json` as the TUI)
- Streaming replies, thinking blocks, and tool activity
- **Model + reasoning effort** picker
- **Slash commands** (`/`) with autocomplete — Grok builtins, skills, and Warp actions
- Compact context, export/copy chat, session history
- Attach images/files, `@` workspace mentions, prompt queue
- Permission modes: **ask** (default) or **yolo** (`/always-approve`)

## Requirements

1. **VS Code** ≥ 1.85 or **Cursor** (recent)
2. **Grok CLI / Grokfork binary** that supports `agent … stdio` (ACP)  
   - Official Grok Build install, **or** a fork binary such as `grokfork`  
   - Must be on your `PATH`, or set **Warp: Binary Path** in settings
3. A **Grok / xAI account** for live chat

Warp does **not** embed the agent binary. Install Grok Build (or your fork) first.

### Binary auto-detect order

1. Setting `warp.binaryPath`
2. `grokfork` / `grok` on `PATH`
3. Common locations, e.g.  
   - `~/.grok/bin/grok`  
   - `~/bin/grokfork` (Windows: `%USERPROFILE%\bin\grokfork.exe`)

## Install

### From VSIX (any machine)

1. Download `warp-0.8.1.vsix` (or build one — see below).
2. In VS Code / Cursor:  
   **Extensions** → `…` → **Install from VSIX…** → pick the file.  
   Or CLI:

```bash
code --install-extension warp-0.8.1.vsix
# Cursor:
cursor --install-extension warp-0.8.1.vsix
```

3. Reload the window.
4. Open the **Warp** view in the **secondary side bar** (right), or run **Warp: Open Chat**.
5. **Sign In** with your Grok account.

### From source

```bash
git clone <this-repo>
cd warp   # or grokfork project root
npm install
npm run compile
npm run package
# then Install from VSIX: warp-0.8.1.vsix
```

### Marketplace / Open VSX

When published, search for **“Warp Grok”** or install:

```text
ext install warp-agent.warp
```

(Publisher id: `warp-agent`. Change `publisher` in `package.json` if you publish under your own namespace.)

## Quick start

| Action | How |
|--------|-----|
| Open chat | Command Palette → **Warp: Open Chat** |
| Sign in | Footer **Sign in**, or **Warp: Sign In** |
| Slash commands | Type `/` or press the `/` toolbar button |
| New chat | Top **+** or `/new` |
| Compact context | `/compact` or click the usage bar |
| Export chat | `/export` |
| Toggle YOLO tools | Footer **ask** / **yolo**, or `/always-approve` |
| Restart agent | **Warp: Restart Agent** |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `warp.binaryPath` | `""` | Absolute path to `grok` / `grokfork`. Empty = auto-detect |
| `warp.alwaysApprove` | `false` | Skip tool permission prompts (`--always-approve`) |
| `warp.mockMode` | `false` | UI-only mock replies (no agent process) |

Open **Settings** and search for `Warp`.

## Security notes

- **Ask mode** (default) may prompt when the agent wants to run tools.  
- **Yolo / always-approve** lets the agent run tools without prompts — only enable if you trust the workspace.
- Auth tokens live in `~/.grok/auth.json` (managed by the Grok CLI), not in the extension package.
- The extension spawns a local child process; it does not send your code to third-party servers itself — the **Grok agent** talks to xAI APIs per your account.

## Slash commands (highlights)

**Warp-handled:** `/new`, `/compact`, `/export`, `/copy`, `/model`, `/effort`, `/always-approve`, `/resume`, `/history`, `/rename`, `/login`, `/logout`, `/multiline`  

**Passed to the agent:** `/context`, `/plan`, skills (`/review`, `/help`, plugins, …) — whatever your Grok install advertises.

## Development

```bash
npm install
npm run compile
npm run watch          # rebuild on change
npm run package        # produce warp-*.vsix
npm run sync:marked    # refresh webview marked bundle
```

Press **F5** in VS Code with this folder open to launch an Extension Development Host (if you add a launch config).

## License

MIT. The extension package includes a `LICENSE` file.

## Disclaimer

Warp is an independent community extension. It is **not** an official product of xAI, Warp.dev, or VS Code. “Grok” and related marks belong to their owners.
