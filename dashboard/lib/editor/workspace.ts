import fs from "node:fs";
import path from "node:path";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { AgentDispatchError } from "@/lib/agent-runs/dispatch";

function secretPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((part) => /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.kube|\.npmrc|\.netrc|\.pypirc|\.devhub|credentials(?:\..*)?|secrets?(?:\..*)?|id_(rsa|ed25519))$/i.test(part)) || /\.(pem|key|p12|pfx)$/i.test(relativePath);
}
export function selectionPath(root: string, relativePath: string): string {
  const parts = relativePath.split(/[\\/]/);
  if (path.isAbsolute(relativePath) || relativePath.includes("\0") || parts.some((part) => !part || part === ".." || part === ".")) throw new AgentDispatchError("Choose a file inside this workspace.", 400);
  if (secretPath(relativePath)) throw new AgentDispatchError("Secret and credential files cannot be sent as selections.", 400);
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, relativePath);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new AgentDispatchError("Workspace path is unavailable.", 400);
    ancestor = parent;
  }
  const real = fs.realpathSync(ancestor);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new AgentDispatchError("Selection path leaves this workspace through a symlink.", 400);
  if (secretPath(path.relative(realRoot, real))) throw new AgentDispatchError("This symlink points to a credential file.", 400);
  return target;
}
export function editorWorkspace(workspaceId: string): string {
  const root = resolveScannedRepo(workspaceId);
  if (!root) throw new AgentDispatchError("Workspace is no longer available. Open it from Repos.", 404);
  return fs.realpathSync(root);
}
