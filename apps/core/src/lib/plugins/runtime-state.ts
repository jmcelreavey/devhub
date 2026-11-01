import fs from "node:fs";
import path from "node:path";
import { profileStateDir } from "../../../../../packages/shared/storage/profile-state";
import { assertSafePath } from "./filesystem";
import type { PluginContext } from "./context";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";

function canonicalBase(base: string): string {
  const missing: string[] = [];
  let current = path.resolve(base);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("State root is unavailable");
    missing.unshift(path.basename(current));
    current = parent;
  }
  const ancestor = fs.realpathSync(current);
  const resolved = path.join(ancestor, ...missing);
  assertSafePath(ancestor, resolved);
  return resolved;
}

export function runtimeStateScopes(ctx: PluginContext, runtime: RuntimeContribution) {
  const declarations = runtime.permissions.state ?? [];
  if (!declarations.length) return { args: [], env: {} };
  const args: string[] = [];
  const scopes = declarations.map(scope => {
    const configured = scope.root === "profile" ? profileStateDir(ctx.env, ctx.home) : ctx.env.XDG_STATE_HOME || path.join(ctx.home, ".local", "state");
    if (!path.isAbsolute(configured)) throw new Error("State root must be absolute");
    const base = canonicalBase(configured);
    const root = path.join(base, scope.path);
    assertSafePath(base, root);
    if (scope.write) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    assertSafePath(base, root);
    args.push(`--allow-fs-read=${root}`);
    if (scope.write) args.push(`--allow-fs-write=${root}`);
    return { ...scope, root };
  });
  return { args, env: { DEVHUB_PLUGIN_STATE_SCOPES: JSON.stringify(scopes) } };
}
