/**
 * ACP client → agent request handlers (fs + permission).
 * Keeps AcpClient free of bulky switch bodies.
 */
import * as fs from "fs";
import * as path from "path";
import { workspaceCwd } from "../paths";
import { resolveSafePath, isPathInside } from "../security/paths";
import { handlePermissionRequest } from "../security/permissions";
import { getPermissionMode } from "../config";

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
      await handlePermissionRequest(id, params, io);
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

function handleReadText(
  id: JsonRpcId,
  params: Record<string, unknown>,
  io: RespondFns
): void {
  const raw = String(params.path || "");
  const abs = resolveAgentFsPath(raw);
  if (!abs) {
    io.respondError(id, "Invalid or disallowed path");
    return;
  }
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
  const raw = String(params.path || "");
  const abs = resolveAgentFsPath(raw);
  if (!abs) {
    io.respondError(id, "Invalid or disallowed path");
    return;
  }
  // Extra guard: when not YOLO, refuse writes outside workspace
  if (getPermissionMode() !== "yolo") {
    const cwd = workspaceCwd();
    if (!isPathInside(abs, cwd)) {
      io.respondError(
        id,
        "Write outside workspace blocked. Enable YOLO or work inside the open folder."
      );
      return;
    }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(params.content ?? ""), "utf8");
  io.respond(id, {});
}

/** Agent may use absolute paths; still normalize and reject empty. */
function resolveAgentFsPath(raw: string): string | null {
  return resolveSafePath(raw, {
    mustBeUnderWorkspace: false,
    allowAbsoluteOutside: true,
  });
}
