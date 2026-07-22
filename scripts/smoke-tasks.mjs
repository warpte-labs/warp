import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { TaskRegistry } = require("../out/acp/tasks.js");

const r = new TaskRegistry();

let hit = r.ingestToolUpdate(
  {
    toolCallId: "call-1",
    title: "spawn_subagent",
    kind: "spawn_subagent",
    status: "in_progress",
    rawInput: {
      description: "Explore auth",
      subagent_type: "explore",
      background: true,
      isolation: "none",
    },
    _meta: {
      "x.ai/tool": {
        name: "spawn_subagent",
        input: {
          description: "Explore auth",
          subagent_type: "explore",
          background: true,
        },
      },
    },
  },
  true
);
console.log("spawn", hit?.task.status, hit?.task.kind, hit?.task.description);

hit = r.ingestToolUpdate(
  {
    toolCallId: "call-1",
    title: "spawn_subagent",
    kind: "spawn_subagent",
    status: "completed",
    rawInput: {
      description: "Explore auth",
      subagent_type: "explore",
      background: true,
    },
    rawOutput: { subagent_id: "sa-abc" },
  },
  false
);
console.log(
  "after spawn complete (bg)",
  hit?.task.status,
  hit?.task.id,
  hit?.task.subagentId
);

hit = r.ingestToolUpdate(
  {
    toolCallId: "call-2",
    kind: "get_command_or_subagent_output",
    status: "completed",
    rawInput: { task_id: "sa-abc" },
    rawOutput: { status: "completed", exit_code: 0 },
  },
  false
);
console.log("after poll", hit?.task.status, r.runningCount(), r.list().length);

hit = r.ingestToolUpdate(
  {
    toolCallId: "call-3",
    kind: "run_terminal_command",
    status: "in_progress",
    rawInput: {
      command: "npm run dev",
      background: true,
      description: "dev server",
    },
  },
  true
);
console.log("bg cmd", hit?.task.kind, hit?.task.description);

hit = r.ingestToolUpdate(
  {
    toolCallId: "call-4",
    kind: "run_terminal_command",
    status: "in_progress",
    rawInput: { command: "ls" },
  },
  true
);
console.log("fg cmd ignored", hit);

console.log("snapshot running=", r.snapshot().running, "total=", r.list().length);
if (r.list().length < 2) process.exit(1);
console.log("OK");
