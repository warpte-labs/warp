/**
 * ACP client → agent request handlers (fs + permission).
 * Keeps AcpClient free of bulky switch bodies.
 */
import * as fs from "fs";
import * as path from "path";
import { workspaceCwd } from "../paths";

export type JsonRpcId = number | string;

export type RespondFns = {
  respond: (id: JsonRpcId, result: unknown) => void;
  respondError: (id: JsonRpcId, message: string) => void;
};

export async function handleClientRequest(
  method: string,
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): Promise<void> {
  try {
    if (method === "session/request_permission") {
      handlePermission(id, params, io);
      return;
    }
    if (method === "fs/read_text_file") {
      handleReadText(id, params, io);
      return;
    }
    if (method === "fs/write_text_file") {
      handleWriteText(id, params, io);
      return;
    }
    io.respondError(id, `Unsupported client method: ${method}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.respondError(id, message);
  }
}

function handlePermission(
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): void {
  const options =
    (params.options as Array<{
      optionId: string;
      name?: string;
      kind?: string;
    }>) || [];
  const allow =
    options.find((o) => /allow/i.test(o.kind || "")) ||
    options.find((o) => /allow/i.test(o.name || "")) ||
    options[0];
  io.respond(id, {
    outcome: allow
      ? { outcome: "selected", optionId: allow.optionId }
      : { outcome: "cancelled" },
  });
}

function handleReadText(
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): void {
  const filePath = String(params.path || "");
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceCwd(), filePath);
  const content = fs.readFileSync(abs, "utf8");
  const limit = params.limit as number | undefined;
  const text =
    typeof limit === "number" && limit > 0
      ? content.split(/\r?\n/).slice(0, limit).join("\n")
      : content;
  io.respond(id, { content: text });
}

function handleWriteText(
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): void {
  const filePath = String(params.path || "");
  const content = String(params.content ?? "");
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceCwd(), filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  io.respond(id, {});
}
