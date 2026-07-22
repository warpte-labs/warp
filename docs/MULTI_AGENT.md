# Warp multi-agent base (host)

Product spec: `grokinfoxai/features.md` (Subagents, Background Tasks, Worktrees).

## Goal

Grok executes multi-agent work. Warp **tracks** it and will **render** it (UI next).

## Host modules

| File | Role |
|------|------|
| `src/acp/tasks.ts` | `TaskRegistry`, `WarpTask`, classify ACP tools |
| `src/acpClient.ts` | Ingest tool_call → emit `task` + `tasks`; spawn env `GROK_SUBAGENTS` |
| `src/agentProcess.ts` | Forward events; `getTasksSnapshot()` |
| `src/webviewProvider.ts` | Post `task` / `tasks` to webview |
| `src/webviewMessages.ts` | `listTasks`; settings `subagentsEnabled` |
| `src/config.ts` | `getSubagentsEnabled()` (default **true**) |
| `package.json` | `warp.subagentsEnabled` |

## Task model

```ts
type WarpTask = {
  id: string;              // subagent/task id when known, else toolCallId
  toolCallId: string;
  subagentId?: string;
  kind: "subagent" | "command" | "monitor" | "loop" | "unknown";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  description: string;
  subagentType?: string;   // general-purpose | explore | plan | …
  capabilityMode?: string;
  isolation?: string;      // none | worktree
  worktreePath?: string;
  background?: boolean;
  toolName?: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
};
```

## Classified tools

| Tool | Kind / effect |
|------|----------------|
| `spawn_subagent` (Task) | Create/update **subagent** row |
| `get_command_or_subagent_output` | Poll → update status |
| `kill_command_or_subagent` | Mark **cancelled** |
| `run_terminal_command` + `background: true` | **command** row |
| `monitor` | **monitor** row |
| `scheduler_create` / loop | **loop** row |

## Webview messages (ready for UI)

**Host → webview**

- `task` — `{ event: "upsert"|"control", task: WarpTask, snapshot }`
- `tasks` — `{ tasks: WarpTask[], running: number, updatedAt }`

**Webview → host**

- `listTasks` — request full snapshot

**Bridge storage (no UI yet)**

- `Warp.tasksState` — last snapshot
- Optional hooks: `global.__warpOnTask`, `__warpOnTasks`, `__warpOnTaskItem`

## Spawn policy

- Never pass `--no-subagents`
- `GROK_SUBAGENTS=1` when `warp.subagentsEnabled` is true (default)
- Setting change requires **agent restart** to re-read env

## Clear rules

- Registry cleared on agent stop / new session / process start
- Tracking never throws into the chat stream

## Frontend (transcript)

| Piece | Behavior |
|-------|----------|
| **Main agent** | Grey spin think circle + orange pulse tool rows (unchanged) |
| **Subagent block** | Header = fill circle + label + type + timer; body = reason + steps |
| **Fill circle** | Ring + core scales from center → outer (`--fill` / `agentFillGrow`) — **no spin, no pulse** |
| **Colors** | Stable per task id (`agentFill.colorFor`) |
| **Steps** | Same tool-row layout as main agent, but fill dots in agent color |
| **Skip** | Multi-agent tool names not shown as generic pulse rows |

## Realtime inventory (app-wide)

| Surface | Live? | Mechanism |
|---------|-------|-----------|
| Chat stream / tools / subagents | Yes | ACP |
| Pro license | Yes | Ably |
| Usage tab | Yes | Log watch + Ably ping |
| Chat history list + detail | Yes | `historyLive` sessions watch |
| Settings form | On open | Enough |

## Still later

- Nested live child thought stream (needs richer ACP child updates)
- Tasks pane / dashboard
