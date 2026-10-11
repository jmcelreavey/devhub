import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const State = z.object({ active: Version, previous: Version.optional() });
export function readEditorVersion(root: string, fallback: string) {
  const file = path.join(root, "active.json");
  if (!fs.existsSync(file)) return { active: fallback, previous: undefined };
  return State.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
export function activateEditorVersion(root: string, version: string, fallback: string) {
  Version.parse(version);
  if (!fs.existsSync(path.join(root, "versions", version, "bin/code-server"))) throw new Error("Editor version is not installed.");
  const current = readEditorVersion(root, fallback);
  const previous = current.active !== version && fs.existsSync(path.join(root, "versions", current.active, "bin/code-server")) ? current.active : current.previous;
  const temporary = path.join(root, "active-" + randomUUID() + ".json");
  fs.writeFileSync(temporary, JSON.stringify({ active: version, previous }), { mode: 0o600 });
  fs.renameSync(temporary, path.join(root, "active.json"));
}
