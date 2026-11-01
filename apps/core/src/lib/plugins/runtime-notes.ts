import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "../content/dirs";
import { PluginApiError, type PluginContext } from "./context";
import { assertSafePath } from "./filesystem";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";

/** Vault grants are separate from private plugin data; replacing a bundle never moves notes. */
export function runtimeNoteScopes(ctx: PluginContext, runtime: RuntimeContribution) {
  const declarations = runtime.permissions.notes ?? [];
  if (!declarations.length) return { args: [], env: {} };
  const configured = ctx.env.NOTES_DIR?.trim() || (ctx.env === process.env ? getNotesDir() : undefined);
  if (!configured) throw new PluginApiError(409, "RUNTIME_NOTES", "Configure the notes vault before running this plugin.");
  const requested = path.resolve(configured);
  const notes = fs.existsSync(requested) ? fs.realpathSync(requested) : requested;
  const args: string[] = [];
  const scopes = declarations.map(scope => {
    const root = path.join(notes, scope.path);
    assertSafePath(notes, root);
    if (scope.write) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    assertSafePath(notes, root);
    args.push(`--allow-fs-read=${root}`);
    if (scope.write) args.push(`--allow-fs-write=${root}`);
    return { ...scope, root };
  });
  return { args, env: { DEVHUB_PLUGIN_NOTE_SCOPES: JSON.stringify(scopes) } };
}
