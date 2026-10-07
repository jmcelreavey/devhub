import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tauriDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const config = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.windows.conf.json"), "utf8"));

test("the NSIS installer loads hooks that keep a deleted Desktop shortcut deleted", () => {
  const hooks = config.bundle.windows.nsis.installerHooks;
  assert.ok(hooks, "tauri.windows.conf.json must name installerHooks");
  const script = fs.readFileSync(path.join(tauriDir, hooks), "utf8");
  assert.match(script, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(script, /!macro NSIS_HOOK_POSTINSTALL/);
  assert.match(script, /\$DESKTOP\\\$\{PRODUCTNAME\}\.lnk/);
  // Only an upgrade (an existing app exe) may suppress the shortcut; a first install keeps it.
  assert.match(script, /FileExists\} "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/);
});
