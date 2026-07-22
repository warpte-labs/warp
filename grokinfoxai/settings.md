# Settings

Grok Build offers a variety of configurations to suit your needs, many of which are made directly available in the TUI under `/settings`.

Settings are persisted under `~/.grok/config.toml` (on Windows, `%USERPROFILE%\.grok\config.toml`). To configure the default home directory, you can set `$GROK_HOME`.

For MCP servers, see [MCP Servers](/build/features/mcp-servers). For marketplaces, skills, and plugins, see [Skills, Plugins, and Marketplaces](/build/features/skills-plugins-marketplaces); for hooks, see [Hooks](/build/features/hooks).

## Scopes

| Scope        | Path                                                           | Use for                                        |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| Environment  | `GROK_*` (and related) variables                               | Session / CI overrides                         |
| User         | `~/.grok/config.toml` (or `$GROK_HOME/config.toml`)            | Personal defaults                              |
| Project      | `.grok/config.toml` in the repo                                | Repo-shared MCP, plugins, and permission rules |
| Managed      | `~/.grok/managed_config.toml`, `/etc/grok/managed_config.toml` | Enterprise-served defaults                     |
| Requirements | `~/.grok/requirements.toml`, `/etc/grok/requirements.toml`     | Policy pins                                    |

Project configs are limited to MCP servers, plugins, and permission rules, not full user configs. For scope merge order and managed deployments, see [Enterprise Deployments](/build/enterprise#configuration). Day-to-day [permissions](/build/features/permissions) and [sandbox](/build/features/sandbox) apply to individual use; managed locks and headless modes are under Enterprise.

## Verification

To confirm which configs are picked up by Grok Build, run the following command:

```bash customLanguage="bash"
grok inspect
```

## Example `config.toml`

Copy into `$GROK_HOME/config.toml`, or `~/.grok/config.toml` when `GROK_HOME` is unset. Prefer `/settings` for UI, notifications, and other in-app options.

```toml customLanguage="toml"
[models]
default = "grok-build"                       # recommended for coding / agent sessions
web_search = "grok-4.5"                      # model used by client-side web_search tool

[model."grok-4.5"]
model = "grok-4.5"                           # id sent to the API
base_url = "https://api.x.ai/v1"             # provider endpoint
name = "Grok 4.5"                            # shown in model picker
description = "Grok 4.5 from xAI"
env_key = "XAI_API_KEY"                      # env var holding the API key
api_backend = "responses"                    # chat_completions | responses | messages
temperature = 0.7
top_p = 0.95
max_completion_tokens = 8192
context_window = 1000000
extra_headers = { "x-api-key" = "xai-..." }
supports_backend_search = true               # if the endpoint supports Grok-hosted server-side search tools

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 6000

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
headers = { "Authorization" = "Bearer ${LINEAR_API_KEY}", "x-mcp-session-id" = "{{session_id}}" }
```

## TOML Values

For the full list of `config.toml` keys, see [TOML Values](/build/settings/reference#toml-values).

## Environment variables

For the full list of environment variables, see [Environment variables](/build/settings/reference#environment-variables).

#### Settings

# Reference

## Environment variables

### Paths and auth

| Variable      | Default   | Description                                                     |
| ------------- | --------- | --------------------------------------------------------------- |
| `GROK_HOME`   | `~/.grok` | Home for config, auth, sessions, skills, plugins, and logs.     |
| `XAI_API_KEY` | —         | API key when not using browser/session login (CI and headless). |

### Models and updates

| Variable                   | Default                         | Description                                                     |
| -------------------------- | ------------------------------- | --------------------------------------------------------------- |
| `GROK_DEFAULT_MODEL`       | catalog / config                | Session default model (same idea as `-m` / `--model`).          |
| `GROK_WEB_SEARCH_MODEL`    | built-in                        | Model used by the `web_search` tool.                            |
| `GROK_MODELS_BASE_URL`     | —                               | Custom inference base URL; model list from `{base}/models`.     |
| `GROK_MODELS_LIST_URL`     | `{GROK_MODELS_BASE_URL}/models` | Override model-list URL when it differs from the default.       |
| `GROK_XAI_API_BASE_URL`    | `https://api.x.ai/v1`           | xAI API base for API-key auth.                                  |
| `GROK_DISABLE_AUTOUPDATER` | unset (updates allowed)         | If set, suppress auto-updater for this process (CI/containers). |

### Tools, sandbox, and features

| Variable                       | Default             | Description                                                                                                 |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GROK_SANDBOX`                 | `off`               | Sandbox profile: `off`, `workspace`, `read-only`, `strict` (or a custom profile name). Same as `--sandbox`. |
| `GROK_SANDBOX_AUTO_ALLOW_BASH` | `0`                 | Auto-allow bash inside an active sandbox (`1`/`0`).                                                         |
| `GROK_RESPECT_GITIGNORE`       | use config if unset | Force gitignore filtering for search/read tools (`1`/`0`); overrides `[tools] respect_gitignore`.           |
| `GROK_WEB_FETCH`               | `0`                 | Enable the `web_fetch` tool (`1`/`0`). Off by default for security.                                         |
| `GROK_WEB_FETCH_PROXY`         | —                   | Egress proxy URL for `web_fetch`.                                                                           |
| `GROK_MEMORY`                  | `0`                 | Enable cross-session memory (`1`/`0`).                                                                      |
| `GROK_SUBAGENTS`               | `0`                 | Enable subagents / the task tool (`1`/`0`).                                                                 |
| `GROK_AGENT`                   | `grok-build`        | Built-in agent name, profile, or absolute path to an agent definition.                                      |
| `GROK_SHOW_THINKING_BLOCKS`    | `0`                 | Show reasoning/thinking blocks in the TUI (`1`/`0`).                                                        |
| `GROK_WRITE_FILE`              | `1`                 | Disable the `write` tool with `0` (read-only sessions).                                                     |
| `GROK_TOOL_SEARCH`             | `1`                 | On-demand MCP tool discovery for large toolsets (`1`/`0`).                                                  |
| `GROK_LSP_TOOLS`               | `0`                 | Enable the LSP code-intel tool (`1`/`0`).                                                                   |

### MCP, logging, and proxy

| Variable                                  | Default    | Description                                                                                                 |
| ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `GROK_MCP_STARTUP_TIMEOUT_SECS`           | `30`       | Global MCP startup handshake timeout in **seconds**. Per-server `startup_timeout_sec` still wins.           |
| `MCP_TIMEOUT`                             | same stack | Claude-compatible MCP startup timeout in **milliseconds** (checked before `GROK_MCP_STARTUP_TIMEOUT_SECS`). |
| `GROK_LOG_FILE`                           | —          | Write logs to this path (useful when the TUI captures stderr).                                              |
| `RUST_LOG`                                | —          | Log filter for `GROK_LOG_FILE` and headless stderr (for example `debug`).                                   |
| `GROK_CRASH_HANDLER`                      | `0`        | On panic, write a report under `$GROK_HOME/crash/` (`1`/`0`).                                               |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | system     | Standard HTTP(S) proxy variables for outbound traffic.                                                      |

### Cursor / Claude compatibility scanners

All default **on** (`true` / `1` or `false` / `0`):

| Variable                     | Description                           |
| ---------------------------- | ------------------------------------- |
| `GROK_CURSOR_SKILLS_ENABLED` | Scan Cursor skills directories.       |
| `GROK_CURSOR_RULES_ENABLED`  | Scan `.cursor/rules/`.                |
| `GROK_CURSOR_AGENTS_ENABLED` | Scan Cursor agent definitions.        |
| `GROK_CURSOR_MCPS_ENABLED`   | Scan Cursor `mcp.json`.               |
| `GROK_CURSOR_HOOKS_ENABLED`  | Scan Cursor hooks.                    |
| `GROK_CLAUDE_SKILLS_ENABLED` | Scan Claude skills.                   |
| `GROK_CLAUDE_RULES_ENABLED`  | Scan Claude rules.                    |
| `GROK_CLAUDE_AGENTS_ENABLED` | Scan `CLAUDE.md` / `CLAUDE.local.md`. |
| `GROK_CLAUDE_MCPS_ENABLED`   | Scan Claude MCP config.               |
| `GROK_CLAUDE_HOOKS_ENABLED`  | Scan Claude hooks.                    |

## TOML Values

Project `.grok/config.toml` only contributes **`[mcp_servers]`**, **`[plugins]`**, and **`[permission]`**. Other sections belong in user config (`~/.grok/config.toml` or `$GROK_HOME/config.toml`).

### `[models]`

| Setting                                           | Values / default                      | Description                                                                  |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `default`                                         | model id (for example `"grok-build"`) | Model used for new sessions.                                                 |
| `web_search`                                      | model id                              | Model used by the client `web_search` tool.                                  |
| `default_reasoning_effort`                        | effort level if supported             | Default reasoning effort for the default model.                              |
| `session_summary`                                 | model id                              | Model used for session summaries.                                            |
| `image_description`                               | model id                              | Model used for image description.                                            |
| `extra_headers`                                   | map                                   | Headers applied to every model (per-model keys win).                         |
| `temperature` / `top_p` / `max_completion_tokens` | numbers                               | Global sampling defaults.                                                    |
| `max_retries`                                     | number                                | Global inference retry default.                                              |
| `stream_tool_calls`                               | `true` / `false`                      | Global tool-call streaming request shape (some BYOK endpoints need `false`). |
| `allowed_models`                                  | glob list                             | Restrict model picker / default / `-m` selection.                            |
| `hidden_models`                                   | id list                               | Hide from the picker (still usable via `-m`).                                |
| `disabled_models`                                 | id list                               | Remove from the catalog (wins over hidden).                                  |

### `[model.<id>]`

Custom / BYOK models (OpenAI-compatible or Anthropic Messages). Prefer `env_key` over hardcoding `api_key`.

| Setting                                           | Values / default   | Description                                                         |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------------------- | ---------- | --------- |
| `model`                                           | string             | Model id sent to the API.                                           |
| `base_url`                                        | URL                | Provider endpoint.                                                  |
| `name`                                            | string             | Label in the model picker.                                          |
| `description`                                     | string             | Optional description.                                               |
| `api_key`                                         | string             | Inline API key (prefer `env_key`).                                  |
| `env_key`                                         | env var name       | Environment variable holding the API key.                           |
| `api_backend`                                     | `chat_completions` | `responses`                                                         | `messages` | Protocol. |
| `temperature` / `top_p` / `max_completion_tokens` | numbers            | Sampling.                                                           |
| `context_window`                                  | tokens             | Context window size (drives auto-compact timing).                   |
| `extra_headers`                                   | map                | Per-request headers.                                                |
| `supports_backend_search`                         | `true` / `false`   | Whether the endpoint supports Grok-hosted server-side search tools. |
| `supports_reasoning_effort` / `reasoning_effort`  | bool / effort      | Reasoning controls when supported.                                  |
| `stream_tool_calls`                               | `true` / `false`   | Per-model tool-call streaming.                                      |
| `max_retries` / `inference_idle_timeout_secs`     | numbers            | Reliability.                                                        |

### `[mcp_servers.<name>]`

String fields such as `url`, `command`, `args`, `env`, and `headers` support `${VAR}` expansion. Headers may also use `{{session_id}}`.

**stdio**

| Setting   | Values / default | Description                        |
| --------- | ---------------- | ---------------------------------- |
| `command` | string           | Executable (for example `npx`).    |
| `args`    | string array     | Arguments.                         |
| `env`     | map              | Process environment.               |
| `cwd`     | path             | Working directory for the process. |

**HTTP / remote**

| Setting                | Values / default | Description                                                  |
| ---------------------- | ---------------- | ------------------------------------------------------------ |
| `url`                  | URL              | HTTP/SSE MCP endpoint.                                       |
| `headers`              | map              | Request headers.                                             |
| `bearer_token_env_var` | env var name     | Inject `Authorization: Bearer` from an environment variable. |

**Common**

| Setting               | Values / default   | Description                              |
| --------------------- | ------------------ | ---------------------------------------- |
| `enabled`             | `true`             | Enable or disable the server.            |
| `startup_timeout_sec` | `30`               | Startup handshake timeout (seconds).     |
| `tool_timeout_sec`    | `6000`             | Default per-tool-call timeout (seconds). |
| `tool_timeouts`       | map name → seconds | Per-tool timeout overrides.              |

### `[tools]` and `[toolset.*]`

| Setting                      | Section               | Values / default                   | Description                                               |
| ---------------------------- | --------------------- | ---------------------------------- | --------------------------------------------------------- | ---------------------- |
| `respect_gitignore`          | `[tools]`             | `true` / `false` (default `false`) | When `true`, search and read tools skip gitignored files. |
| `file_toolset`               | `[toolset]`           | `standard` (default)               | `hashline`                                                | File edit tool scheme. |
| `timeout_secs`               | `[toolset.bash]`      | seconds (default `120`)            | Foreground bash command timeout.                          |
| `output_byte_limit`          | `[toolset.bash]`      | bytes (default `20000`)            | Max captured bash output.                                 |
| `max_timeout_secs`           | `[toolset.bash]`      | seconds (default `36000`)          | Cap on model-requested foreground timeouts.               |
| `auto_background_on_timeout` | `[toolset.bash]`      | `true` / `false` (default `true`)  | Auto-background the command on timeout.                   |
| `proxy_endpoint`             | `[toolset.web_fetch]` | URL                                | Egress proxy for `web_fetch`.                             |
| `allowed_domains`            | `[toolset.web_fetch]` | string array                       | Domain allowlist override for `web_fetch`.                |

### `[sandbox]` (`config.toml`)

| Setting           | Values / default                   | Description                                                    |
| ----------------- | ---------------------------------- | -------------------------------------------------------------- | ----------- | -------------------- | ------------------------------------------------------------------------------- |
| `profile`         | `off` (default)                    | `workspace`                                                    | `read-only` | `strict` (or custom) | Filesystem sandbox profile. Custom profile names are defined in `sandbox.toml`. |
| `auto_allow_bash` | `true` / `false` (default `false`) | Skip bash permission prompts when a sandbox profile is active. |

### `sandbox.toml` custom profiles

Define custom profiles in `~/.grok/sandbox.toml` (user) or `.grok/sandbox.toml` (project). Activate with `[sandbox] profile = "…"` in `config.toml`, `--sandbox`, or `GROK_SANDBOX`. Built-in names (`off`, `workspace`, `read-only`, `strict`, `devbox`) cannot be redefined as custom profiles.

```toml customLanguage="toml"
[profiles.project]
extends = "workspace"
restrict_network = false
read_only = ["/data"]
read_write = ["/tmp/scratch"]
# Kernel-enforced deny (read + write/rename). Entries with *, ?, or [ are globs.
deny = ["/data/shared-secrets", "**/.env", "**/*.pem"]
```

| Setting            | Values / default                 | Description                                                                                                                             |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ---------------------------- |
| `extends`          | `workspace` (default if omitted) | `devbox`                                                                                                                                | `read-only` | `strict` | Built-in profile to inherit. |
| `restrict_network` | `true` / `false`                 | Restrict network access (Linux seccomp when enforced).                                                                                  |
| `read_only`        | path list                        | Additional read-only paths.                                                                                                             |
| `read_write`       | path list                        | Additional read-write paths.                                                                                                            |
| `deny`             | path or **glob** list            | Kernel-enforced deny for read and write/rename. An entry is a glob if it contains `*`, `?`, or `[` (for example `**/.env`, `**/*.pem`). |

A non-empty `deny` list is enforced at the kernel level when the sandbox can be applied. On Linux, read-deny requires `bubblewrap`. Operator guide: [Sandbox](/build/features/sandbox). Managed pins: [Enterprise Deployments](/build/enterprise#sandbox).

### `[session]`, `[cli]`, and `[hints]`

| Setting                          | Section     | Values / default                         | Description                                           |
| -------------------------------- | ----------- | ---------------------------------------- | ----------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `auto_compact_threshold_percent` | `[session]` | `0–100` (default `85`)                   | Auto-compact when context usage reaches this percent. |
| `load_envrc`                     | `[session]` | `true` / `false` (default `true`)        | Inject `.envrc` variables into bash.                  |
| `auto_update`                    | `[cli]`     | `true` / `false` (default on when unset) | Check for CLI updates on launch.                      |
| `channel`                        | `[cli]`     | `stable`                                 | `alpha`                                               | Release channel preference. |
| `show_tips`                      | `[cli]`     | `true` / `false`                         | Startup tips.                                         |
| `new_session_worktree_mode`      | `[hints]`   | `ask`                                    | `always`                                              | `never` (default `never`)   | Whether `/new` offers a [worktree](/build/features/worktrees). |
| `fork_worktree_mode`             | `[hints]`   | `ask`                                    | `always`                                              | `never` (default `ask`)     | Whether `/fork` offers a worktree.                             |

### `[permission]`

Project-scoped and user-scoped. Evaluation order: **deny > ask > allow**.

| Setting                  | Values                                | Description                                                                                      |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | -------------------- | ------ | ------ | ------ | ------ | ----- | ----------- |
| `allow` / `deny` / `ask` | rule string arrays                    | Compact rules, for example `Bash(git *)`, `Read(src/**)`, `Edit(**/*.rs)`, `MCPTool(server__*)`. |
| `rules`                  | array of `{ action, tool, pattern? }` | Verbose form. `action`: `allow`                                                                  | `deny` | `ask`. `tool`: `any` | `bash` | `edit` | `read` | `grep` | `mcp` | `webfetch`. |

### `[features]`, `[subagents]`, and `[memory]`

| Setting       | Section              | Values / default               | Description                                  |
| ------------- | -------------------- | ------------------------------ | -------------------------------------------- |
| `web_fetch`   | `[features]`         | `true` / `false`               | Enable the `web_fetch` tool.                 |
| `lsp_tools`   | `[features]`         | `true` / `false` (default off) | Expose the LSP tool.                         |
| `write_file`  | `[features]`         | `true` / `false` (default on)  | Enable the `write` tool.                     |
| `tool_search` | `[features]`         | `true` / `false` (default on)  | MCP tool search / discovery.                 |
| `enabled`     | `[subagents]`        | `true` / `false`               | Subagent / task tool master switch.          |
| `toggle`      | `[subagents.toggle]` | map of subagent → bool         | Enable or disable individual subagent types. |
| `models`      | `[subagents.models]` | map of subagent → model id     | Per-subagent model routing.                  |
| `enabled`     | `[memory]`           | `true` / `false` (default off) | Cross-session memory master switch.          |

### `[skills]`, `[plugins]`, and `[compat.*]`

| Setting                                          | Section                               | Values                            | Description                                                  |
| ------------------------------------------------ | ------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `paths`                                          | `[skills]` / `[plugins]`              | path lists                        | Extra skill or plugin directories.                           |
| `disabled`                                       | `[skills]` / `[plugins]`              | name lists                        | Discover but do not activate.                                |
| `enabled`                                        | `[plugins]`                           | name lists                        | Explicitly enable plugins (project plugins may default off). |
| `skills` / `rules` / `agents` / `mcps` / `hooks` | `[compat.cursor]` / `[compat.claude]` | `true` / `false` (default `true`) | Scan Cursor or Claude harness directories.                   |
