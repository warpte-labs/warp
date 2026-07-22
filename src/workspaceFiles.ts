import * as path from "path";
import * as vscode from "vscode";
import { workspaceCwd } from "./paths";

export type WorkspaceFileHit = {
  path: string;
  name: string;
  dir: string;
};

/**
 * List workspace files for @-mention (relative paths).
 */
export async function listWorkspaceFiles(
  query = "",
  limit = 60
): Promise<WorkspaceFileHit[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }

  const root = folder.uri;
  const cwd = workspaceCwd();
  const q = query.trim().toLowerCase().replace(/^@/, "");

  let uris: vscode.Uri[] = [];
  try {
    uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*"),
      "**/{node_modules,.git,out,dist,build,.next,target,bin}/**",
      800
    );
  } catch {
    return [];
  }

  const hits: WorkspaceFileHit[] = [];
  for (const uri of uris) {
    const rel = path.relative(cwd, uri.fsPath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) {
      continue;
    }
    const name = path.basename(rel);
    const dir = path.posix.dirname(rel);
    if (q) {
      const hay = (rel + " " + name).toLowerCase();
      if (!hay.includes(q)) {
        continue;
      }
    }
    hits.push({ path: rel, name, dir: dir === "." ? "" : dir });
    if (hits.length >= limit) {
      break;
    }
  }

  hits.sort((a, b) => {
    // Prefer shorter paths / name match first
    if (q) {
      const an = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (an !== bn) {
        return an - bn;
      }
    }
    return a.path.localeCompare(b.path);
  });

  return hits;
}
