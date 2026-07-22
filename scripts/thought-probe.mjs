import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const bin = "C:\\\\Users\\\\alecc\\\\bin\\\\grokfork.exe";
const child = spawn(bin, ["agent", "--always-approve", "stdio"], { cwd: process.cwd(), stdio: ["pipe","pipe","pipe"], windowsHide: true });
let id = 0; const pending = new Map();
function send(method, params) {
  const reqId = ++id;
  child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:reqId, method, params }) + "\n");
  return new Promise((res, rej) => { pending.set(reqId, {res, rej}); setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); rej(new Error("timeout "+method)); } }, 60000); });
}
const kinds = {};
const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result);
  }
  if (msg.method === "session/update") {
    const k = msg.params?.update?.sessionUpdate;
    kinds[k] = (kinds[k]||0)+1;
    if (k === "agent_thought_chunk" && kinds[k] <= 3) {
      console.log("THOUGHT sample", JSON.stringify(msg.params.update).slice(0, 300));
    }
  }
});
try {
  await send("initialize", { protocolVersion:1, clientInfo:{name:"warp-debug",version:"0.4.3"}, clientCapabilities:{ fs:{ readTextFile:true, writeTextFile:true } } });
  try { await send("authenticate", { methodId: "cached_token" }); } catch {}
  const sess = await send("session/new", { cwd: process.cwd(), mcpServers: [] });
  await send("session/prompt", { sessionId: sess.sessionId, prompt: [{ type:"text", text: "Reply with one word: hi. Think briefly first." }] });
  console.log("KINDS", JSON.stringify(kinds));
} catch (e) { console.error("ERR", e); }
child.kill();
process.exit(0);
