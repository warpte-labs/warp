# Grok fork settings → Warp candidates

Survey of `~/.grok/config.toml` / Grok Build docs for settings Warp could surface or respect.

## Already wired in Warp

| Area | Source | Warp behavior |
|------|--------|----------------|
| Model + effort | ACP `session/new` models + `session/set_model` + `_meta.reasoningEffort` | Meta drop-up: Low / Med / High |
| Context window size | Model `_meta.totalContextTokens` | Footer “ctx used / total · %” |
| Live usage | `session/update` params `_meta.totalTokens` | Footer updates during turns |
| Auth | `~/.grok/auth.json` cached_token | Sign in / Sign out |
| Sessions | `~/.grok/sessions` | History panel |
| Always-approve | agent `--always-approve` + `warp.alwaysApprove` | Footer **yolo/ask** chip + `/always-approve` |
| Slash commands | ACP `available_commands_update` + host list | `/` palette + host intercepts |
| Export / copy | host clipboard + save dialog | `/export`, `/copy` |
| Rename session | `summary.json` `generated_title` | `/rename` · `/title` |
| Prompt recall | webview history | ↑ empty / `/history` |
| Multi-agent registry | ACP `spawn_subagent` / bg tools | Host `TaskRegistry` → `task` / `tasks` events; `GROK_SUBAGENTS` via `warp.subagentsEnabled` |
| List tasks | webview `listTasks` | Snapshot of running/completed subagents + bg work |

## High value remaining

| Setting | Grok home | Why for Warp |
|---------|-----------|--------------|
| `auto_compact_threshold_percent` | `[session]` (default 85) | Auto-warn near limit (compact UI exists) |
| `show_thinking_blocks` | `[ui]` | Toggle CoT visibility |
| `group_tool_verbs` | `[ui]` | Collapse tool spam in transcript |
| `collapsed_edit_blocks` | `[ui]` | Diffstat-style edit rows |
| `default` model | `[models]` | Remember preferred model on session/new |
| `default_reasoning_effort` | models / config | Seed High/Med/Low |
| `respect_gitignore` | `[tools]` | Match IDE ignore when listing @ files |
| Sandbox / permission mode | CLI flags | Safer defaults for public install |
| Plan mode UI | `/plan` · `/view-plan` | Currently pass-through prompt only |
| Rewind / fork | pager | Need turn-index + ACP support |

## Medium value

| Setting | Notes |
|---------|--------|
| `max_completion_tokens` | Cap agent replies |
| `temperature` / `top_p` | Rarely needed for coding agent |
| `stream_tool_calls` | Provider quirks |
| `codebase_indexing` | Heavy; leave to Grok agent process |
| `load_envrc` | Session env |
| Theming | Warp already uses own CSS tokens |
| MCP server list | Surface from agent `_x.ai/mcp/*` later |

## Context indicator (implemented)

- **Total**: `availableModels[]._meta.totalContextTokens` (e.g. 500000 for Grok 4.5)
- **Used**: `session/update` → `params._meta.totalTokens` (Grok emits on thought/message chunks)
- **UI**: footer left of Sign in/out → `ctx 7.5k / 500k · 2%`
- Colors: default grey · ≥70% warn · ≥90% hot

## File open links (implemented)

- Markdown paths and `a[href]` that look like files → `openFile` → `vscode.workspace.openTextDocument` + `showTextDocument`
