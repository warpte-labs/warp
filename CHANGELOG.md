# Changelog

All notable changes to **Warp** are documented in this file.

## [0.9.34] — 2026-07-22

### Usage (real tokens)
- Chart + daily breakdown from `shell.turn.inference_done` in `~/.grok/logs/unified.jsonl`
- Tracks prompt / cached / completion / reasoning tokens per day and session
- Credits bar from Grok billing log (`creditUsagePercent` + period reset)
- Fast path: mtime/size cache, append-only log tail, summary-only session counts

### Settings
- Categorized settings, permission toggles, Usage drill-in (ECharts)

## [0.9.0] — 2026-07-22


### Security
- **Ask mode is real**: tool `session/request_permission` shows a QuickPick (no longer auto-allows)
- **YOLO confirm**: enabling always-approve requires a modal confirmation
- **Write guard**: ACP file writes outside the workspace blocked while in ask mode
- **Path hardening**: webview open/attach paths go through shared safe resolvers
- **Auth gate**: prompt/compact require signed-in session on the host

### Architecture (DRY / modular)
- `config.ts` — single settings source
- `util.ts` — shared `errMsg` / `delay`
- `security/paths.ts` + `security/permissions.ts`
- `commands.ts` — thin `extension.ts`
- Webview `util.js` for shared format/escape helpers

## [0.8.1] — 2026-07-22

### Public release packaging
- Marketplace-ready metadata, MIT license, README, and clean VSIX contents
- Safer default: `warp.alwaysApprove` is **off** (ask mode); enable YOLO in settings or `/always-approve`
- Improved Grok binary discovery on Windows, macOS, and Linux (PATH + common install locations)
- Clearer errors when the agent binary is missing
- 128×128 extension icon

### Features (0.8.0)
- Slash command palette from ACP `available_commands` + Warp host commands
- Host intercepts: compact, new, export, copy, model/effort, always-approve, rename, login/logout, multiline
- Permission chip (yolo / ask) in the footer
- Prompt history with ↑/↓

## [0.7.x]

- Context usage bar, compact bar, model + effort picker
- Session history, attachments, @ file mentions, prompt queue
- OAuth sign-in via Grok CLI
