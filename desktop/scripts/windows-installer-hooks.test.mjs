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

test("the installer stops only DevHub's own app and WSL sidecar before replacing files", () => {
  const script = fs.readFileSync(path.join(tauriDir, config.bundle.windows.nsis.installerHooks), "utf8");
  const macro = script.match(/!macro DevHubStopOwnProcesses([\s\S]*?)!macroend/)?.[1] ?? "";
  assert.ok(macro, "a stop macro must exist");
  // Runs first in PREINSTALL, before anything is replaced.
  assert.match(script, /!macro NSIS_HOOK_PREINSTALL\s+!insertmacro DevHubStopOwnProcesses/);
  // The Windows side: our exe, and only when it lives under this install folder.
  assert.match(macro, /\$\{MAINBINARYNAME\}\.exe/);
  assert.match(macro, /StartsWith\(\$\$dir/);
  assert.match(macro, /\$INSTDIR/);
  // The Linux side: only the supervisor unpacked under the app's runtime folder.
  assert.match(macro, /pkill -TERM -f '\\\.local\/share\/devhub\/runtime\/\[\^ \/\]\+\/services\/supervisor\\\.mjs'/);
  // Never services the user runs themselves, and never kills by image name or port.
  assert.doesNotMatch(macro, /devhub\.service|devhub-paseo|paseo|systemctl|openchamber/i);
  assert.doesNotMatch(macro, /taskkill|Stop-Process -Name|netstat|Get-NetTCPConnection|pkill -9|pkill -KILL/i);
  // A missing WSL or distro must not fail the install: the command always exits 0 and is popped.
  assert.match(macro, /exit 0/);
  assert.match(macro, /SilentlyContinue/);
  assert.equal(macro.match(/nsExec::Exec/g)?.length, macro.match(/Pop \$0/g)?.length, "every command's result is popped");
  // NSIS's default string limit is 1024 characters.
  for (const line of macro.split("\n").filter((l) => l.includes("nsExec::Exec"))) assert.ok(line.length < 900, `command is ${line.length} characters`);
  // The distro name is validated before it reaches wsl.exe.
  assert.match(macro, /-match '\^\[A-Za-z0-9\._-\]\+\$\$'/);
});
