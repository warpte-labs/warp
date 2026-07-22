import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const bin = process.env.WARP_BIN || "C:\\Users\\alecc\\bin\\grokfork.exe";
const child = spawn(bin, ["agent", "--always-approve", "stdio"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: { ...process.env },
});

let id = 0;
const pending = new Map();

function send(method, params) {
  const reqId = ++id;
  const msg = { jsonrpc: "2.0", id: reqId, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 20000);
  });
}

const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  console.log("<<", line.slice(0, 400));
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
  // Auto-answer client requests
  if (msg.method && msg.id != null && !msg.result) {
    if (msg.method === "session/request_permission") {
      const opts = msg.params?.options || [];
      const allow =
        opts.find((o) => /allow/i.test(o.kind || o.name || "")) || opts[0];
      const resp = {
        jsonrpc: "2.0",
        id: msg.id,
        result: allow
          ? { outcome: { outcome: "selected", optionId: allow.optionId } }
          : { outcome: { outcome: "cancelled" } },
      };
      child.stdin.write(JSON.stringify(resp) + "\n");
      console.log(">> permission auto", allow?.optionId);
    } else if (msg.method === "fs/read_text_file") {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: "" },
        }) + "\n"
      );
    } else if (msg.method === "fs/write_text_file") {
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n"
      );
    } else {
      console.log("unhandled client method", msg.method);
    }
  }
});

child.stderr.on("data", (d) => {
  console.error("ERR", d.toString().slice(0, 500));
});

child.on("exit", (c) => console.error("exit", c));

try {
  const init = await send("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "warp", version: "0.2.0" },
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
  });
  console.log("INIT OK keys", Object.keys(init || {}));
  console.log(
    "authMethods",
    JSON.stringify(init?.authMethods || init?.auth_methods || []).slice(0, 300)
  );

  const sess = await send("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  });
  console.log("SESSION", JSON.stringify(sess).slice(0, 300));

  const sessionId = sess.sessionId || sess.session_id;
  const promptP = send("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "Reply with exactly: pong" }],
  });

  const result = await promptP;
  console.log("PROMPT RESULT", JSON.stringify(result).slice(0, 400));
} catch (e) {
  console.error("FAIL", e);
} finally {
  child.kill();
  process.exit(0);
}
