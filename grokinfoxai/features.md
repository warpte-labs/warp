#### Features

# Skills, Plugins & Marketplaces

## Skills

Skills are reusable folders containing markdown instructions, script files, and resources for agents.

Grok discovers skills from:

- `./.grok/skills/` (walked up to the repo root)
- `~/.grok/skills/`
- Any enabled plugin's `skills/` directory
- Extra paths under `[skills] paths` in `~/.grok/config.toml`

User-invocable skills also appear as slash commands, for example `/<skill-name>`.

## Plugins

Plugins extend Grok with additional skills, agents, hooks, MCP servers, and LSP servers.

Grok loads plugins from:

- `./.grok/plugins/`
- `~/.grok/plugins/`
- Marketplace installs under `~/.grok/plugins/marketplaces/`
- Extra paths under `[plugins] paths` in `~/.grok/config.toml`
- `--plugin-dir <PATH>` on the CLI

Manage plugins, hooks, skills, and MCP servers from a single extensions modal in the TUI — open it with any of `/plugins`, `/hooks`, `/skills`, or `/mcps`.

## Hooks

Hooks run scripts on tool and session lifecycle events, such as before or after tool calls.

Grok discovers hooks from:

- `~/.grok/hooks/` (extra roots via `~/.grok/hooks-paths`)
- Project `.grok/hooks/` (requires `/hooks-trust`)
- Enabled plugins

Plugin hooks additionally receive `GROK_PLUGIN_ROOT` and `GROK_PLUGIN_DATA` in their environment. For events, the JSON format, and the script contract, see [Hooks](/build/features/hooks).

## Marketplaces

The TUI includes a Marketplace tab for browsing and installing plugins from configured sources.

Marketplace sources come from `[[marketplace.sources]]` in `~/.grok/config.toml` and `~/.grok/plugins/known_marketplaces.json`.

## Subagents

Subagents spawn independent child sessions that handle tasks in parallel. Types and personas are under [Subagents](/build/features/subagents).

## Claude Code compatibility

Grok is fully compatible with Claude Code with zero configuration needed.

Grok automatically reads Claude Code marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files (`CLAUDE.md`, `Claude.md`, `CLAUDE.local.md`, and `.claude/rules/`) alongside `.grok/`. No extra setup is needed.

## Agents.md compatibility

Grok also reads the `AGENTS.md` instruction-file family (`AGENTS.md`, `Agents.md`, `AGENT.md`) walked from cwd to the repo root — see [AGENTS.md](/build/features/project-rules) — and discovers user-level skills and commands from:

- `~/.agents/skills/`
- `~/.agents/commands/`

#### Features

# AGENTS.md

Project rules are Markdown files that Grok loads into context for every session in a directory tree. Put coding conventions, build and test commands, and architecture notes in an `AGENTS.md` at your repo root, and Grok follows them without being told each session.

## Discovery

Grok loads rules in this order, with deeper files taking precedence on conflicts:

1. Global rules in `~/.grok/`
2. Every directory from the repo root down to the working directory (or only the working directory outside a git repo)

Within each directory, Grok reads any of `AGENTS.md`, `Agents.md`, `AGENT.md`, `CLAUDE.md`, `Claude.md`, and `CLAUDE.local.md`, plus every `*.md` file in a `.grok/rules/` directory (`.claude/rules/` and `.cursor/rules/` are read for compatibility). Files ignored by `.gitignore` are skipped, which keeps personal overrides like `CLAUDE.local.md` out of shared context.

A nested `AGENTS.md` scopes to its subtree, so a monorepo can carry different conventions per package:

```text
my-monorepo/
  AGENTS.md                # repo-wide rules
  packages/
    frontend/AGENTS.md     # "Use React. Prefer CSS modules."
    backend/AGENTS.md      # "Use Express. Follow REST conventions."
```

Files are loaded in full, with no size cap; short, specific instructions are followed more reliably than long ones.

## Session rules

To add rules for a single run without editing files, pass `--rules` (Grok appends the text to the system prompt), or `--system-prompt-override` to replace the system prompt entirely:

```bash customLanguage="bash"
grok --rules "Always use TypeScript. Prefer functional components."
```

## Verification

```bash customLanguage="bash"
grok inspect
```

This lists each rules file Grok found, with its path and approximate token count.

#### Features

# MCP Servers

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) servers expose external tools to Grok. Once configured, their tools are available alongside the built-in ones, namespaced as `<server>__<tool>`.

## Adding a server

The fastest way is the `grok mcp` command:

```bash customLanguage="bash"
# Local stdio server; everything after -- is the server command
grok mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /path/to/dir

# Remote server over HTTP (OAuth handled automatically)
grok mcp add --transport http linear https://mcp.linear.app/mcp

# Remote server with a static auth header (--header is repeatable)
grok mcp add --transport http api https://mcp.example.com/mcp --header "Authorization: Bearer ${API_TOKEN}"
```

`grok mcp list` shows configured servers, `grok mcp remove <name>` deletes one, and `grok mcp doctor [name]` diagnoses configuration and connectivity. `list` and `doctor` take `--json` for machine-readable output.

Servers can also be declared directly in `~/.grok/config.toml`:

```toml customLanguage="toml"
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
env = { API_KEY = "${MY_API_KEY}" }   # ${VAR} expands at load time
startup_timeout_sec = 30              # default 30
tool_timeout_sec = 6000               # default 6000

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
headers = { "x-mcp-session-id" = "{{session_id}}" }
```

Grok expands `${VAR}` (and `${VAR:-default}`) in `url`, `command`, `args`, `env`, and `headers`, so secrets can stay in the environment. Servers that require OAuth trigger a browser flow on first use; tokens are stored under `~/.grok/mcp_credentials.json`.

## Project scope

Pass `--scope project` to `grok mcp add` (it writes `.grok/config.toml` in the current directory) to define servers that ship with the repo. When loading, Grok walks from the current directory up to the git root reading each `.grok/config.toml`, and a project server with the same name as a user one replaces it entirely.

## In the TUI

`/mcps` opens the MCP tab of the extensions modal: toggle a server with `Space`, refresh after config edits with `r`, authenticate OAuth servers with `i`, and add or remove with `a` and `x`.

## Compatibility

Grok also loads MCP configurations from `~/.claude.json`, `.cursor/mcp.json`, and project `.mcp.json` files, merged below `config.toml` in priority. Disable a vendor with `[compat.claude] mcps = false` or `[compat.cursor] mcps = false`. `grok inspect` shows every loaded server and its origin.

## Troubleshooting

`grok mcp doctor` is the first stop. For stdio servers that start but fail to connect, Grok captures stderr to `~/.grok/logs/mcp/<server>.stderr.log`. Cold-start `npx` servers that download packages on first launch may need a higher `startup_timeout_sec`.

#### Features

# Hooks

A hook is a shell command or HTTP endpoint that Grok calls when a lifecycle event occurs: block a dangerous command before it runs, log tool use, run a formatter after edits, or send a notification when a turn ends.

## Configuration

Hooks are JSON files. Personal hooks live in `~/.grok/hooks/*.json`; project hooks live in `<project>/.grok/hooks/*.json`. Claude Code (`.claude/settings.json`) and Cursor (`.cursor/hooks.json`) hook files are read as well, including Cursor's camelCase event names.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "bin/safety-check.sh", "timeout": 10 }
        ]
      }
    ]
  }
}
```

`matcher` is a regular expression tested against the tool name (Claude tool names such as `Bash`, `Read`, and `Edit` are mapped to Grok's automatically); omit it to match everything. `type` is `"command"` or `"http"` (with a `url` to POST the event to). `timeout` is in seconds, default 5. Manage and inspect loaded hooks in the `/hooks` tab of the extensions modal.

Project hooks require trust before they run: the first time you open a repo with hooks, grant it with `/hooks-trust` or by launching with `--trust`. The decision is stored in `~/.grok/trusted_folders.toml` and covers project MCP and LSP servers too.

## Events

| Event                               | Fires when                                       |
| ----------------------------------- | ------------------------------------------------ |
| `SessionStart`, `SessionEnd`        | A session starts or ends                         |
| `UserPromptSubmit`                  | You submit a prompt                              |
| `PreToolUse`                        | A tool is about to run — the only blocking event |
| `PostToolUse`, `PostToolUseFailure` | A tool completes or fails                        |
| `PermissionDenied`                  | The permission system denies a tool call         |
| `Stop`, `StopFailure`               | A turn ends, or ends with an API error           |
| `Notification`                      | The agent sends a notification                   |
| `SubagentStart`, `SubagentStop`     | A subagent starts or finishes                    |
| `PreCompact`, `PostCompact`         | Conversation compaction runs                     |

## The script contract

The event arrives as JSON on stdin, including `hookEventName`, `sessionId`, `cwd`, `workspaceRoot`, and for tool events `toolName` and `toolInput`. Every hook process also receives `GROK_HOOK_EVENT`, `GROK_HOOK_NAME`, `GROK_SESSION_ID`, and `GROK_WORKSPACE_ROOT` in its environment.

A `PreToolUse` hook decides by writing JSON to stdout:

```json
{ "decision": "deny", "reason": "Unsafe command detected" }
```

Exit code 0 allows, exit code 2 denies. Everything else — timeouts, crashes, malformed output — is fail-open: the failure is recorded in the session but the tool call proceeds. Only an explicit `deny` blocks. For passive events, stdout is ignored; exit 0 on success.

#### Features

# Sessions

Grok saves every conversation to disk automatically — prompts, responses, tool calls, and file snapshots — under `~/.grok/sessions/`, keyed by working directory. Sessions work the same in the TUI, headless mode, and over ACP.

## Resuming

In the TUI, `/resume` opens a picker of recent sessions for the current workspace; the welcome screen lists them too. From the command line:

```bash customLanguage="bash"
grok --resume <session-id>   # a specific session
grok --resume                # the most recent for this directory
grok -c                      # shorthand: continue the most recent
```

In headless mode, read the session ID back from JSON output and pass it to `-r` to build multi-step automations:

```bash customLanguage="bash"
grok -p "Start the refactor" --output-format json | jq -r '.sessionId'
```

`-s, --session-id` names a new session with a UUID you supply; it does not resume existing ones. To branch a resumed session instead of continuing it, add `--fork-session`.

## Forking

`/fork [directive]` branches the current session into a peer that starts from a copy of the conversation. Pass `--worktree` or `--no-worktree` to choose whether the fork runs in an isolated copy of the repository, so parallel sessions do not overwrite each other's files — see [Worktrees](/build/features/worktrees).

## Rewinding

`/rewind` (or `Esc Esc` while idle) lists a rewind point per prompt. Selecting one restores all files to their state at that point and truncates the conversation to match. Rewind modifies files on disk — reverted changes are lost unless committed to git.

## Compacting

`/compact [context]` compresses the conversation history to reclaim context window, with optional instructions about what to preserve. Grok also auto-compacts as the context window fills; check usage with `/context` or `/session-info`.

## Todos

For multi-step work, the agent keeps a structured todo list so you can see what is planned, what is in progress, and what is done. Items use statuses pending, in progress, completed, and cancelled (when a step is dropped).

On the agent screen, press `Ctrl+T` to view the todo pane. The list is part of the session: resume the same session and the todos return with their last statuses.

Todos are separate from [background tasks](/build/features/background-tasks), which track long-running commands and monitors.

## Housekeeping

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `/sessions`                    | Switch, rename, or close active sessions                |
| `/rename <title>`              | Rename the current session (alias `/title`)             |
| `grok sessions list`           | List recent sessions for this directory                 |
| `grok sessions search <query>` | Search session titles and prompts                       |
| `grok sessions delete <id>`    | Permanently delete a session                            |
| `grok export <id> [file]`      | Export a transcript as Markdown (`--clipboard` to copy) |

#### Features

# Plan Mode

In plan mode the agent explores the codebase and drafts a plan for your approval before it edits anything.

## When to use

|              |                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Use for**  | Ambiguous architecture, unclear requirements, or high-impact restructures                                                    |
| **Skip for** | Clear one-path changes, obvious bug fixes, renames, formatting, pure research ([explore](/build/features/subagents) instead) |

## Enter plan mode

- **`/plan`** — Enter plan mode (active on your next prompt). `/plan <description>` enters and starts a turn.
- **`Shift+Tab`** — Cycle modes. From Normal, one press lands on Plan (then Auto when available, then Always-approve).

The agent can enter plan mode on its own when a task looks ambiguous. That is not a permission prompt. Leave with `Shift+Tab` when idle, or with `q` on the approval screen.

## Review and approve

When planning finishes, the TUI opens a plan preview. Auto and always-approve do not skip this review. Use **`/view-plan`** (aliases `/show-plan`, `/plan-view`) to reopen a saved preview.

| Shortcut | Action                                                        |
| -------- | ------------------------------------------------------------- |
| `a`      | Approve and start building (or approve with pending comments) |
| `s`      | Request changes (type notes, then Enter)                      |
| `c`      | Comment on the selected line or range                         |
| `q`      | Quit plan and turn plan mode off                              |
| `Tab`    | Focus between plan preview and prompt                         |

An empty plan still opens this surface. Plan mode stays on until you approve or quit.

## Caveats

- Only the session plan file may be edited until you approve. Other edit tools are rejected, including under auto or always-approve. Reads, bash, and MCP still follow [permission mode](/build/features/permissions). Plan mode gates edit tools, not the shell — bash can still write via redirection.
- [Subagents](/build/features/subagents) are not edit-gated by the parent’s plan mode; they do inherit permission mode (including auto and always-approve).
- Status shows `plan` while planning and `plan approval` on the review screen. The `auto` or always-approve flag returns when plan mode ends.

#### Features

# Permissions

Permissions decide which tool calls may run. The [sandbox](/build/features/sandbox) is separate: it limits what an approved call can do on the filesystem and network.

## Modes

| Mode           | Behavior                                                                                                  | Enter via                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Ask (default)  | Prompt for anything not already allowed                                                                   | —                                                                 |
| Auto           | Classifier auto-approves safe tools; dangerous ones may still prompt (`deny` rules and hooks still apply) | `/auto`, `Shift+Tab` when the feature is on                       |
| Always-approve | Auto-approve tool calls (`deny` rules and PreToolUse hooks still apply)                                   | `/always-approve`, `Ctrl+O`, `Shift+Tab`, `grok --always-approve` |

`Shift+Tab` cycles Normal → Plan → Auto (when available) → Always-approve. `/auto` only appears when the auto permission-mode feature is enabled. Running `/auto` while always-approve is on (or the reverse) switches modes rather than stacking them. Status shows `auto` when auto is active and plan mode is not.

Default in user config only (`~/.grok/config.toml` or managed/requirements — not project `.grok/config.toml`):

```text
[ui]
permission_mode = "auto" # or "ask" | "always-approve"
```

Legacy keys `approval_mode` and `yolo = true` still work; `permission_mode` wins when more than one is set.

[Plan mode](/build/features/plan-mode) is independent: edit tools stay limited while planning, and the plan review UI is not skipped under auto or always-approve.

Headless modes such as `dontAsk` and locking always-approve off: [Enterprise Deployments](/build/enterprise#permissions).

## Allow and deny rules

```text
[permission]
rules = [
  { action = "allow", tool = "bash", pattern = "git *" },
  { action = "allow", tool = "read" },
  { action = "deny",  tool = "bash", pattern = "rm -rf *" },
]
```

`--allow` / `--deny` take the same patterns per invocation. Supported filters include `Bash`, `Edit`, `Read`, `Grep`, `MCPTool`, `WebFetch`, and `WebSearch`. `deny` always wins over `allow`.

A remembered “always allow” grant still prompts for dangerous patterns such as `rm` and `git push`. An explicit config or CLI allow rule auto-approves them. Under always-approve they run unless you add a deny.

#### Features

# Sandbox

The sandbox limits what the agent process and its children can read, write, and reach on the network (Landlock on Linux, Seatbelt on macOS). Off by default. Permissions gate whether a tool call runs; the sandbox limits what an approved call can do — see [Permissions](/build/features/permissions).

## Profiles

| Profile     | Filesystem read      | Filesystem write              | Child network | Use case                  |
| ----------- | -------------------- | ----------------------------- | ------------- | ------------------------- |
| `off`       | Unrestricted         | Unrestricted                  | Allowed       | No sandbox (default)      |
| `workspace` | Everywhere           | CWD, `~/.grok/`, temp         | Allowed       | Normal development        |
| `devbox`    | Everywhere           | Top-level dirs except `/data` | Allowed       | Cloud devbox environments |
| `read-only` | Everywhere           | `~/.grok/` and temp only      | Blocked       | Code review, auditing     |
| `strict`    | CWD and system paths | CWD, `~/.grok/`, temp         | Blocked       | Untrusted repositories    |

| Limitation         | Detail                                                                                |
| ------------------ | ------------------------------------------------------------------------------------- |
| Child network      | Enforced on Linux only; no-op on macOS for `read-only` / `strict`                     |
| Credentials        | Built-ins do not permanently protect paths such as `~/.ssh`; use a custom `deny` list |
| `~/.grok/`         | Stays writable under sandboxed profiles so sessions can persist                       |
| In-process network | Model API and web tools are not blocked by child-network settings                     |

## Enable a profile

| Mechanism   | Example                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| CLI         | `grok --sandbox workspace`                                                       |
| Config      | `[sandbox] profile = "workspace"` in `~/.grok/config.toml`                       |
| Env         | `GROK_SANDBOX=workspace`                                                         |
| Managed pin | `requirements.toml` (can override CLI) — [Enterprise](/build/enterprise#sandbox) |

## Custom profiles

Define named profiles in `~/.grok/sandbox.toml` or project `.grok/sandbox.toml`:

```text
[profiles.my-profile]
extends = "workspace"
restrict_network = true
deny = ["/secrets", "**/.env", "**/*.pem"]
```

Select with `--sandbox my-profile` or `[sandbox] profile`. Built-in names cannot be redefined for selection. Field details: [Settings Reference](/build/settings/reference).

For untrusted trees, pair a strict profile with narrow [permission](/build/features/permissions) allows (or headless `dontAsk`).

#### Features

# Subagents

Subagents are independent child sessions with their own context. They return a summary to the parent when finished. Enabled by default when the setting is unset.

## Built-in types

| Type              | Role                                               |
| ----------------- | -------------------------------------------------- |
| `general-purpose` | Default full-capability child                      |
| `explore`         | Read, list, and search only (no shell, no edits)   |
| `plan`            | Drafts an implementation plan (no shell, no edits) |

Add or override types under `.grok/agents/` or `~/.grok/agents/`. Manage agents and personas with `/config-agents` (alias `/agents`) or `/personas`. Personas are behavioral overlays only (tone, focus, contracts); define them under `[subagents.personas]` or `.grok/personas/*.toml` / `~/.grok/personas/*.toml`.

#### Features

# Worktrees

A worktree session runs in an isolated copy of your repository, so parallel agents cannot overwrite each other's files. Worktrees require a git repository, live under `~/.grok/worktrees/<repo>/<name>`, and start from your current HEAD, including uncommitted changes. [Subagents](/build/features/subagents) can also request worktree isolation when the parent delegates parallel work.

## Starting one

```bash customLanguage="bash"
grok -w
grok --worktree=feat "refactor module X" # = keeps the prompt out of the name
grok -w --ref main "fix the flaky test"  # clean checkout of the ref
grok -w -r <session-id>                  # resume in a fresh worktree
```

In the TUI: `/fork --worktree` forks the current session into a worktree, `Ctrl+W` on the welcome screen opens the New Worktree dialog, and `Ctrl+W` in the [Agent Dashboard](/build/features/dashboard) dispatches new agents into worktrees. Whether `/new` and `/fork` offer a worktree is configurable — see [TOML Values](/build/settings/reference#toml-values).

A worktree is a real git checkout, detached at its base commit; land changes with ordinary git.

## Housekeeping

Worktrees persist until you remove them: ending or deleting a session leaves its worktree in place, and `gc` runs only when you invoke it.

| Command                     | What it does                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `grok worktree list`        | List tracked worktrees                                                                                             |
| `grok worktree show <id>`   | Show details for one worktree                                                                                      |
| `grok worktree rm <ids...>` | Remove worktrees (`--dry-run` to preview)                                                                          |
| `grok worktree gc`          | Remove entries whose directory is gone; `--max-age 7d` also expires idle worktrees not in use by a running process |

#### Features

# Background Tasks

Grok can run commands, subagents, and monitors in the background while the conversation continues. Press `Ctrl+G` to open the tasks pane listing everything currently running, or run `/tasks` for a snapshot in the scrollback; press `Ctrl+B` to demote a running foreground command to the background instead of waiting for it. This is separate from the agent’s [todos](/build/features/sessions#todos) (`Ctrl+T` on the agent screen), which track planned multi-step work rather than running processes.

## Background commands

The agent starts dev servers, builds, and other long-running commands as background tasks on its own, and collects their output when needed. Ask for it directly ("run the dev server in the background") or let the agent decide. In the scrollback, select a background task and press `x` to kill it.

## Scheduled prompts

`/loop` runs a prompt on a recurring interval:

```text
/loop 5m Check if the test suite passes and report any failures
```

The interval accepts `Ns` (minimum 60), `Nm`, `Nh`, and `Nd`. The prompt fires immediately, then repeats; each firing is a new agent turn. Loops expire after 7 days, and at most 50 scheduled tasks can be active at once. Cancel from the tasks pane, or ask the agent to.

## Monitors

For real-time event streams rather than periodic checks, the agent can attach a monitor to a script: each line the script prints becomes a notification in the conversation. Ask for one when you want to watch a log, a CI run, or a port ("watch the deploy logs and tell me if anything errors"). Keep monitor scripts selective — every output line interrupts the conversation.

## Prompt queue

Prompts submitted while a turn is running are queued, not dropped. `Ctrl+;` toggles the queue panel and `/queue` lists it.

#### Features

# Agent Dashboard

The dashboard is a fullscreen overview of every session: which agents need input, which are working, and which are done. Open it with `Ctrl+\`, the `/dashboard` command, or `grok dashboard` from the shell.

Rows are grouped by state — Needs input, Working, Idle, Inactive, Completed, Failed — and update live. Press `Ctrl+G` to group by directory instead.

## Working with agents

Selecting a row opens a peek panel showing the agent's latest activity. Type to reply: an idle agent receives the message immediately, a busy one queues it. Permission prompts and questions can be answered inline with the number keys. Press `Enter` to attach to the session in a full details view; `Ctrl+\` returns to the dashboard, and `Ctrl+[` / `Ctrl+]` cycle between sessions.

The input bar at the bottom dispatches prompts to new sessions. `Ctrl+L` changes the working directory for new agents, and `Ctrl+W` toggles whether they start in a [git worktree](/build/features/worktrees).

## Keys

| Keys                | Action                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `↑`/`↓`             | Select row                                                        |
| `Enter`             | Open the selected session                                         |
| `Ctrl+/`            | Search — `a:<name>` by agent, `s:<state>` by state, or plain text |
| `Ctrl+T`            | Pin / unpin agent                                                 |
| `Ctrl+R`            | Rename agent                                                      |
| `Ctrl+X`            | Stop / close agent (press twice)                                  |
| `Shift+↑`/`Shift+↓` | Reorder pinned agents                                             |
| `Esc`               | Close peek, then filter, then the dashboard                       |

Grouping and pins persist under `[dashboard]` in `~/.grok/config.toml`. Set `enabled = false` there, or `GROK_AGENT_DASHBOARD=0`, to disable the feature.

#### Features

# Theming

Run `/theme` (alias `/t`) to open the theme picker with a live preview, `/theme <name>` to switch directly, or set it in `~/.grok/config.toml`:

```toml customLanguage="toml"
[ui]
theme = "tokyonight"
```

## Built-in themes

| Theme               | Names                        | Truecolor required |
| ------------------- | ---------------------------- | ------------------ |
| GrokNight (default) | `groknight`, `dark`          | No                 |
| GrokDay             | `grokday`, `light`, `day`    | No                 |
| TokyoNight          | `tokyonight`, `tokyo`        | Yes                |
| RosePineMoon        | `rosepine`, `rose-pine-moon` | Yes                |
| OscuraMidnight      | `oscura`, `oscura-midnight`  | Yes                |

On terminals without truecolor, themes are quantized to the available palette and the picker hides the truecolor-only entries. If colors look wrong, see [Terminal Support](/build/cli/terminal-support).

## Following the system appearance

Set `theme = "auto"` (alias `"system"`) to track your OS light/dark setting; changes apply within seconds, without a restart. Dark maps to GrokNight and light to GrokDay unless overridden:

```toml customLanguage="toml"
[ui]
theme = "auto"
auto_dark_theme = "tokyonight"
auto_light_theme = "grokday"
```

For a denser layout, `/compact-mode` reduces padding and persists the choice. Finer appearance controls (scrollback layout, block styling, animations) live in `~/.grok/pager.toml`.
