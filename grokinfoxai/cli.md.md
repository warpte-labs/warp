#### CLI

# Headless & Scripting

## Headless mode

Use headless mode for scripts, bots, or other machine-friendly tasks.

```bash customLanguage="bash"
grok -p "Your prompt here"
```

Common flags:

| Flag                    | What it does                                               |
| ----------------------- | ---------------------------------------------------------- |
| `-p, --single <PROMPT>` | Send one prompt                                            |
| `-m, --model <MODEL>`   | Choose a model                                             |
| `-s, --session-id <ID>` | Create or resume a named headless session                  |
| `-r, --resume <ID>`     | Resume an existing session                                 |
| `-c, --continue`        | Continue the most recent session in the current directory  |
| `--cwd <PATH>`          | Set the working directory                                  |
| `--output-format <FMT>` | Choose `plain`, `json`, or `streaming-json`                |
| `--always-approve`      | Auto-approve tool executions                               |
| `--no-alt-screen`       | Run inline (no alternate screen / fullscreen TUI takeover) |

**Sessions:** Headless sessions (via `--session-id`, `--resume`, `--continue`) are stored in `~/.grok/sessions`.

**Suppressing updates in xai-grok-shell:** When using headless mode (`-p`) or ACP (`grok agent stdio`) in scripts, CI, or other automated environments, pass `--no-auto-update` (e.g. `grok --no-auto-update -p "..."`) to skip background update checks. You can also persistently disable them by setting `auto_update = false` under the `[cli]` section in `~/.grok/config.toml`.

## Output formats

- `plain`: human-readable text
- `json`: one JSON object at the end
- `streaming-json`: newline-delimited JSON events

```bash customLanguage="bash"
grok -p "List TODO comments" --output-format json
grok -p "Explain the architecture" --output-format streaming-json
```

Streaming JSON emits incremental events as they arrive.

## ACP

Use ACP when you want IDE or tool integration rather than a terminal session.

```bash customLanguage="bash"
grok agent stdio
```

This runs Grok as an ACP agent over JSON-RPC on stdin/stdout. The example below assumes `grok` is already authenticated locally, or `XAI_API_KEY` is set. `session/prompt` returns completion metadata; the assistant text itself arrives as `session/update` chunks.

```javascript customLanguage="javascriptWithoutSDK"
import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";

const proc = spawn("grok", ["agent", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});
const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
let nextId = 1;
let text = "";

proc.stderr.on("data", (chunk) => process.stderr.write(chunk));

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "session/update") {
    const update = message.params?.update;
    if (
      update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.text
    ) {
      text += update.content.text;
    }
    return;
  }

  const pendingRequest = pending.get(message.id);
  if (!pendingRequest) return;

  pending.delete(message.id);
  if (message.error) {
    pendingRequest.reject(
      new Error(message.error.message ?? JSON.stringify(message.error)),
    );
  } else {
    pendingRequest.resolve(message.result ?? {});
  }
});

function request(method, params, timeoutMs = 30000) {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve(result) {
        clearTimeout(timer);
        resolve(result);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });

    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
  });

  const authMethods = new Set(
    (init.authMethods ?? []).map((method) => method.id),
  );
  const methodId =
    process.env.XAI_API_KEY && authMethods.has("xai.api_key")
      ? "xai.api_key"
      : authMethods.has("cached_token")
        ? "cached_token"
        : null;

  if (!methodId) {
    throw new Error("Run `grok login` first, or set XAI_API_KEY.");
  }

  await request("authenticate", { methodId, _meta: { headless: true } });

  const { sessionId } = await request("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  });

  const prompt = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "Say hello in one short sentence." }],
  });

  let lastLength = -1;
  let stableChecks = 0;
  while (stableChecks < 2) {
    await sleep(150);
    if (text.length === lastLength) {
      stableChecks += 1;
    } else {
      lastLength = text.length;
      stableChecks = 0;
    }
  }

  console.log(
    text.trim() || `No text returned (stopReason=${prompt.stopReason})`,
  );
} finally {
  rl.close();
  proc.kill();
}
```

#### CLI

# CLI Reference

Running `grok` with no arguments starts the interactive TUI. This page lists the subcommands and the flags you are most likely to use; run `grok --help` or `grok <subcommand> --help` for the complete set.

## Subcommands

| Command                                                                              | What it does                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `grok login`                                                                         | Sign in. `--device-auth` uses device-code authentication for headless or remote environments                             |
| `grok logout`                                                                        | Sign out and clear cached credentials                                                                                    |
| `grok inspect [--json]`                                                              | Show the configuration Grok discovers for this directory: rules, skills, plugins, hooks, and MCP servers                 |
| `grok models`                                                                        | List available models                                                                                                    |
| `grok mcp <list\|add\|remove\|doctor>`                                               | Manage MCP servers — see [MCP Servers](/build/features/mcp-servers)                                                      |
| `grok plugin <list\|install\|uninstall\|update\|enable\|disable\|details\|validate>` | Manage plugins                                                                                                           |
| `grok plugin marketplace <list\|add\|remove\|update>`                                | Manage marketplace sources                                                                                               |
| `grok sessions <list\|search\|delete>`                                               | List, search, or delete sessions — see [Sessions](/build/features/sessions)                                              |
| `grok export <session-id> [output]`                                                  | Export a session transcript as Markdown                                                                                  |
| `grok import [targets...]`                                                           | Import sessions from Claude Code                                                                                         |
| `grok memory clear [--workspace\|--global\|--all]`                                   | Clear cross-session memory files                                                                                         |
| `grok worktree <list\|show\|rm\|gc>`                                                 | Manage git worktrees created for sessions — see [Worktrees](/build/features/worktrees)                                   |
| `grok dashboard`                                                                     | Open the [Agent Dashboard](/build/features/dashboard)                                                                    |
| `grok agent stdio`                                                                   | Run as an ACP agent over stdin/stdout — see [Headless & Scripting](/build/cli/headless-scripting#acp)                    |
| `grok wrap <command...>`                                                             | Run a command in a local PTY that forwards OSC 52 clipboard writes — see [Terminal Support](/build/cli/terminal-support) |
| `grok update`                                                                        | Check for updates or install a specific version (`--check`, `--version <V>`, `--alpha`, `--stable`)                      |
| `grok version`                                                                       | Print version information                                                                                                |
| `grok completions <shell>`                                                           | Generate shell completion scripts                                                                                        |
| `grok setup`                                                                         | Fetch and install managed configuration                                                                                  |

## Common flags

Flags for headless runs (`-p`, `--output-format`, and related) are covered in [Headless & Scripting](/build/cli/headless-scripting).

| Flag                                                                 | What it does                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `--cwd <PATH>`                                                       | Working directory                                                 |
| `-r, --resume [<ID>]`                                                | Resume a session by ID, or the most recent if omitted             |
| `-c, --continue`                                                     | Continue the most recent session for the current directory        |
| `-s, --session-id <UUID>`                                            | Use a specific UUID for a new session                             |
| `--fork-session`                                                     | When resuming, fork into a new session ID                         |
| `-w, --worktree [<NAME>]`                                            | Start the session in a new git worktree                           |
| `--ref <REF>`                                                        | Branch, tag, or commit to base the worktree on                    |
| `-m, --model <MODEL>`                                                | Model ID to use                                                   |
| `--effort <LEVEL>`                                                   | Reasoning effort                                                  |
| `--always-approve`                                                   | Auto-approve all tool executions (alias `--yolo`)                 |
| `--allow <RULE>`, `--deny <RULE>`                                    | Permission rules — see [Permissions](/build/features/permissions) |
| `--sandbox <PROFILE>`                                                | Sandbox profile — see [Sandbox](/build/features/sandbox)          |
| `--rules <TEXT>`                                                     | Extra rules appended to the system prompt                         |
| `--system-prompt-override <TEXT>`                                    | Replace the system prompt entirely                                |
| `--tools <LIST>`, `--disallowed-tools <LIST>`                        | Allow or remove built-in tools                                    |
| `--max-turns <N>`                                                    | Maximum number of agent turns                                     |
| `--no-plan`, `--no-subagents`, `--no-memory`, `--disable-web-search` | Disable a feature for this session                                |
| `--experimental-memory`                                              | Enable cross-session memory                                       |
| `--oauth`                                                            | Use OAuth when the welcome screen starts authentication           |

Claude Code flag names are accepted as aliases where they overlap: `--allowedTools`, `--disallowedTools`, `--append-system-prompt`, `--system-prompt`, and `--dangerously-skip-permissions`.

#### CLI

# Terminal Support

Grok draws its interface with terminal escape sequences for color, clipboard, mouse, and full-screen control, and some terminals, multiplexers, and SSH sessions handle these differently. Run `/terminal-setup` (aliases `/terminal-check`, `/terminal-info`) inside Grok to see what was detected, which clipboard routes are active, and any issues with fixes.

## Colors look wrong

Set `COLORTERM=truecolor` in your shell profile. Inside tmux, also enable 24-bit RGB:

```text
# ~/.tmux.conf
set -g default-terminal "tmux-256color"
set -as terminal-features ",*:RGB"
set -g set-clipboard on
set -g allow-passthrough on
```

The last two lines also fix clipboard and notification passthrough; reload with `tmux source-file ~/.tmux.conf`.

## Copy does not reach my clipboard

Grok writes to the native OS clipboard, to the tmux paste buffer inside tmux, and emits OSC 52 for remote cases (SSH, containers, Linux). Two common blockers:

- iTerm2 ignores OSC 52 until you enable Settings → General → Selection → "Applications in terminal may access clipboard".
- Apple Terminal ignores OSC 52 entirely, so copies over SSH cannot reach your local clipboard. Wrap the remote command instead: `grok wrap ssh user@host` runs it in a local PTY that intercepts OSC 52 and writes to your clipboard. The same works for `grok wrap docker exec ...` and `grok wrap kubectl exec ...`. `grok wrap` is experimental.

## Keyboard chords do not work

- WezTerm: add `config.enable_kitty_keyboard = true` to `wezterm.lua`, then restart — this fixes `Ctrl+Enter` (interject) and `Shift+Enter` (newline).
- VS Code, Cursor, Windsurf, and Zed terminals cannot distinguish `Shift+Enter` from `Enter`; use `Alt+Enter` for newlines. The same applies to VS Code over SSH.
- Zellij intercepts many Ctrl chords. On Zellij 0.41+, switch to the "Unlock-First (non-colliding)" preset (`Ctrl+O` → `c` → Change Mode Behavior), then `Ctrl+G` temporarily unlocks Zellij when you need it.
- Apple Terminal: `Ctrl+O` interjects (it lacks the Kitty keyboard protocol for `Ctrl+Enter`).

## No fullscreen, or mouse scrolling stops

Grok intentionally runs inline under Zellij and tmux control mode (`tmux -CC`); force fullscreen with `alt_screen = "always"` under `[terminal]` in `~/.grok/pager.toml`, or disable it anywhere with `--no-alt-screen`.

If your terminal's native scrollbar takes over, mouse reporting is off: Apple Terminal re-enables it under View → Allow Mouse Reporting (`Cmd+R`); iTerm2 under Settings → Profiles → Terminal → "Enable mouse reporting".

Still stuck? Run `/feedback`.
