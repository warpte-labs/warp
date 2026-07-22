# Modes and Commands

The TUI has pager-local slash commands, plus a smaller set provided by `xai-grok-shell`. User-invocable skills also appear as slash commands.

In the TUI, `Shift+Tab` cycles session modes. For the full key reference, see [Keyboard Shortcuts](/build/keyboard-shortcuts).

## Modes

### Plan

Plan mode is planning first: only the session plan file can be edited until you approve. That file-edit gate is independent of the permission mode (ask, auto, or always-approve). Enter with `/plan [description]` or `Shift+Tab`, and reopen a plan with `/view-plan`. See [Plan Mode](/build/features/plan-mode).

### Auto

Auto uses a classifier to auto-approve safe tools; dangerous ones may still prompt. Toggle with `/auto` or `Shift+Tab` when the feature is enabled. Full mode table: [Permissions](/build/features/permissions).

### Always-approve

Always-approve skips permission prompts for tool calls (`deny` rules and hooks still apply). Toggle with `/always-approve` or `Shift+Tab`, or start with `grok --always-approve`. Modes, allow/deny rules, and how they relate to the sandbox are under [Permissions](/build/features/permissions).

## Core TUI commands

The command palette groups session, context, model, and tool actions.

Use `/context` to check current context usage.

| Command                               | What it does                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/quit` (alias `/exit`)               | Quit the application                                                                            |
| `/help`                               | Browse commands and keyboard shortcuts                                                          |
| `/home`                               | Return to the welcome screen                                                                    |
| `/new` (alias `/clear`)               | Start a new session                                                                             |
| `/resume`                             | Resume a previous session                                                                       |
| `/sessions`                           | Switch, rename, or close active sessions                                                        |
| `/fork`                               | Branch the current session into a peer agent                                                    |
| `/rename <title>` (alias `/title`)    | Rename the current session                                                                      |
| `/share`                              | Share the current session via URL                                                               |
| `/session-info`                       | Show session info                                                                               |
| `/context`                            | View context usage                                                                              |
| `/compact [context]`                  | Compact conversation history                                                                    |
| `/rewind`                             | Rewind to a previous turn                                                                       |
| `/export`                             | Export the conversation to a file or clipboard                                                  |
| `/copy [N]`                           | Copy the last (or Nth-latest) response to the clipboard                                         |
| `/find`                               | Search the conversation scrollback                                                              |
| `/transcript`                         | View the full transcript in your pager (`$PAGER`)                                               |
| `/model <name>` (alias `/m`)          | Switch the active model                                                                         |
| `/effort`                             | Set reasoning effort for the current model                                                      |
| `/always-approve`                     | Toggle always-approve mode                                                                      |
| `/auto`                               | Toggle auto mode (classifier; when feature enabled)                                             |
| `/plan [description]`                 | Enter plan mode                                                                                 |
| `/view-plan`                          | View the current plan                                                                           |
| `/btw <question>`                     | Ask a side question without interrupting                                                        |
| `/loop [interval] <prompt>`           | Run a prompt on a recurring interval — see [Background Tasks](/build/features/background-tasks) |
| `/imagine <prompt>`                   | Generate an image from a text description                                                       |
| `/imagine-video <prompt>`             | Generate a video from a text description                                                        |
| `/tasks`                              | List background tasks, subagents, and scheduled tasks                                           |
| `/queue`                              | List the prompts queued behind the running turn                                                 |
| `/dashboard`                          | Open the [Agent Dashboard](/build/features/dashboard)                                           |
| `/settings` (alias `/config`)         | Open the settings modal                                                                         |
| `/theme [name]` (alias `/t`)          | Switch the color theme                                                                          |
| `/compact-mode`                       | Toggle denser UI layout                                                                         |
| `/multiline` (alias `/ml`)            | Toggle multiline input                                                                          |
| `/vim-mode`                           | Toggle vim-style scrollback keybindings                                                         |
| `/timestamps`                         | Toggle message timestamps                                                                       |
| `/terminal-setup`                     | Check terminal and clipboard setup                                                              |
| `/config-agents` (alias `/agents`)    | Manage agent definitions                                                                        |
| `/personas`                           | Manage personas                                                                                 |
| `/remember <note>`                    | Save a memory note                                                                              |
| `/import-claude`                      | Open the Claude settings import modal                                                           |
| `/feedback [text]`                    | Send feedback about the current session                                                         |
| `/release-notes` (alias `/changelog`) | View release notes for the current version                                                      |
| `/usage`                              | View credit usage or manage billing                                                             |
| `/privacy`                            | Show or toggle privacy and data-retention status                                                |
| `/login`, `/logout`                   | Sign in, or sign out of the current account                                                     |
| `/hooks`                              | Open the unified extensions modal at the Hooks tab                                              |
| `/plugins`                            | Open the unified extensions modal at the Plugins tab                                            |
| `/marketplace`                        | Open the unified extensions modal at the Marketplace tab                                        |
| `/skills`                             | Open the unified extensions modal at the Skills tab                                             |
| `/mcps`                               | Open the unified extensions modal at the MCP tab                                                |

`/hooks`, `/plugins`, `/marketplace`, `/skills`, and `/mcps` all open the same extensions modal — they just pre-select a tab. A few commands appear only when their feature is available (for example `/imagine` and `/loop`).

## Shell-provided commands

| Command                  | What it does                           |
| ------------------------ | -------------------------------------- |
| `/flush`                 | Flush conversation memory to disk now  |
| `/memory` (alias `/mem`) | Browse, view, and manage your memories |
| `/dream`                 | Run memory consolidation               |

These appear when cross-session memory is enabled.

## Skills as commands

Any user-invocable skill can also appear as a slash command, for example `/<skill-name>`.

If names collide, use the qualified form, such as `/local:commit`.

# Keyboard Shortcuts

Press `Ctrl+.` (or `Ctrl+X` on Windows and in terminals without the Kitty keyboard protocol) to open this list inside the TUI; entries that do not apply in the current context are dimmed.

Some chords differ by terminal; see [Terminal differences](#terminal-differences).

## Essentials

| Keys                | Action                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `Enter`             | Send the prompt                                                   |
| `Tab`               | Move focus between prompt and scrollback                          |
| `Esc`               | Cancel the running turn                                           |
| `Esc Esc`           | Clear the prompt, or open rewind when it is empty                 |
| `Ctrl+C`            | Cancel turn                                                       |
| `Shift+Tab`         | Cycle mode (Normal / Plan / Auto when available / Always-approve) |
| `Ctrl+P` or `?`     | Command palette                                                   |
| `Ctrl+.` / `Ctrl+X` | Keyboard shortcuts                                                |
| `F2` or `Ctrl+,`    | Settings                                                          |
| `Ctrl+Q` / `Ctrl+D` | Quit (press twice)                                                |

## Input

| Keys                     | Action                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `Ctrl+Enter` or `Ctrl+I` | Interject while a turn is running                                                     |
| `Shift+Enter`            | Newline — or send, in multiline mode (`Alt+Enter` where `Shift+Enter` is unsupported) |
| `Ctrl+M`                 | Toggle multiline input                                                                |
| `Ctrl+R`                 | Search prompt history                                                                 |
| `!`                      | Shell mode, on an empty prompt                                                        |

## Scrollback

Focus the scrollback with `Tab`, then navigate. Bare-letter keys require vim mode (`/vim-mode`, or `vim_mode = true` under `[ui]` in `config.toml`); the arrow-key equivalents always work.

| Keys                                         | Action                                           |
| -------------------------------------------- | ------------------------------------------------ |
| `j` / `↓`, `k` / `↑`                         | Select next / previous entry                     |
| `Shift+L` / `Shift+→`, `Shift+H` / `Shift+←` | Next / previous turn                             |
| `Shift+J`, `Shift+K`                         | Next / previous response                         |
| `g`, `Shift+G`                               | Go to top / bottom                               |
| `Ctrl+U`, `Ctrl+D`                           | Scroll half page up / down                       |
| `Page Up`, `Page Down`                       | Scroll one page up / down                        |
| `h` / `←`, `l` / `→`                         | Collapse / expand the selected entry             |
| `e`, `Shift+E`                               | Expand or collapse one entry / all entries       |
| `Ctrl+E`                                     | Toggle all thinking blocks                       |
| `r`                                          | Toggle raw markdown                              |
| `y`, `Shift+Y`                               | Copy content / copy command or path              |
| `Enter` or `Ctrl+F`                          | Open the selected block in the fullscreen viewer |
| `/`                                          | Search scrollback (vim mode)                     |
| `x`                                          | Kill the selected background task                |

## Panels and session

| Keys                 | Action                                                                |
| -------------------- | --------------------------------------------------------------------- |
| `Ctrl+T`             | Toggle the [todo pane](/build/features/sessions#todos) (agent screen) |
| `Ctrl+B`             | Send the running command to the background                            |
| `Ctrl+;` or `Ctrl+'` | Toggle prompt queue                                                   |
| `Ctrl+S`             | Open sessions                                                         |
| `Ctrl+L`             | Open extensions                                                       |
| `Ctrl+G`             | Toggle the [tasks pane](/build/features/background-tasks)             |
| `Ctrl+O`             | Toggle always-approve                                                 |
| `Ctrl+N`             | New session (press twice)                                             |
| `Ctrl+M`             | Pick model, when the prompt is not focused                            |
| `Ctrl+\`             | Open the [Agent Dashboard](/build/features/dashboard)                 |

## Terminal differences

- VS Code-family terminals (VS Code, Cursor, Windsurf, Zed): quit is `Ctrl+D` only, interject is `Ctrl+L`, half-page scroll is `Shift+D`, and `Ctrl+L` does not open extensions (use `/plugins`). Use `Alt+Enter` for newlines.
- Apple Terminal: `Ctrl+O` also interjects.
- WezTerm needs `enable_kitty_keyboard = true` for `Ctrl+Enter` and `Shift+Enter`.

See [Terminal Support](/build/cli/terminal-support) for fixes and diagnostics.
