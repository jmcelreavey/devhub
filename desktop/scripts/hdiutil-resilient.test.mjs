import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(desktopDir, "..");
const shim = path.join(desktopDir, "scripts", "hdiutil-resilient.sh");
const workflow = fs.readFileSync(path.join(repoDir, ".github", "workflows", "release-desktop.yml"), "utf8");

const POSIX = process.platform !== "win32";

const FAKE_HDIUTIL = `#!/bin/bash
echo "hdiutil $*" >> "$FAKE_STATE/calls"
case "$1" in
  info)
    if [ -f "$FAKE_STATE/info.txt" ]; then cat "$FAKE_STATE/info.txt"
    elif [ -f "$FAKE_STATE/attached" ]; then
      printf '/dev/disk4\\tGUID_partition_scheme\\t\\n/dev/disk4s1\\tApple_HFS\\t/Volumes/dmg.test\\n'
    fi
    exit 0 ;;
  detach)
    n=$(cat "$FAKE_STATE/detach-count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_STATE/detach-count"
    case " $* " in *" -force "*) forced=1 ;; *) forced=0 ;; esac
    if [ "\${FAKE_DETACH_VANISHES:-0}" = 1 ]; then rm -f "$FAKE_STATE/attached"; echo "hdiutil: detach: timeout for DiskArbitration expired" >&2; exit 1; fi
    ok=0
    if [ "\${FAKE_DETACH_OK_ON:-0}" -ne 0 ] && [ "$n" -ge "\${FAKE_DETACH_OK_ON}" ]; then ok=1; fi
    if [ "\${FAKE_DETACH_NEEDS_FORCE:-0}" = 1 ]; then ok=$forced; fi
    if [ "$ok" = 1 ]; then rm -f "$FAKE_STATE/attached"; exit 0; fi
    echo "hdiutil: detach: drive not detached" >&2; exit 1 ;;
  create) echo "created: $FAKE_STATE/out.dmg"; exit "\${FAKE_CREATE_RC:-0}" ;;
  *) echo "passthrough $*"; exit 0 ;;
esac
`;

const FAKE_DISKUTIL = `#!/bin/bash
echo "diskutil $*" >> "$FAKE_STATE/calls"
if [ "$1" = eject ] && [ "\${FAKE_EJECT_WORKS:-0}" = 1 ]; then rm -f "$FAKE_STATE/attached"; fi
exit 0
`;

const RECORD = (name) => `#!/bin/bash\necho "${name}\${*:+ $*}" >> "$FAKE_STATE/calls"\nexit 0\n`;

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-hdiutil-"));
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  const put = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  put("hdiutil", FAKE_HDIUTIL);
  put("diskutil", FAKE_DISKUTIL);
  // The real mdutil/pkill must never run. sudo forwards to the recording fakes, so
  // the assertions hold whether the shim takes its root or its sudo path.
  put("sudo", `#!/bin/bash\n[ "$1" = -n ] && shift\nexec "$@"\n`);
  put("mdutil", RECORD("mdutil"));
  put("pkill", RECORD("pkill"));
  put("sync", RECORD("sync"));
  put("lsof", RECORD("lsof"));
  fs.writeFileSync(path.join(state, "attached"), "");
  const calls = () => {
    try {
      return fs.readFileSync(path.join(state, "calls"), "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const run = (args, env = {}) =>
    spawnSync("bash", [shim, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_STATE: state,
        DEVHUB_REAL_HDIUTIL: path.join(bin, "hdiutil"),
        DEVHUB_REAL_DISKUTIL: path.join(bin, "diskutil"),
        DEVHUB_DMG_DETACH_BACKOFF: "0",
        DEVHUB_DMG_SETTLE: "0",
        DEVHUB_DMG_STEP_TIMEOUT: "10",
        DEVHUB_DMG_LOG: path.join(root, "shim.log"),
        ...env,
      },
    });
  const count = (prefix) => calls().filter((c) => c.startsWith(prefix)).length;
  return { root, state, run, calls, count, log: () => fs.readFileSync(path.join(root, "shim.log"), "utf8") };
}

test("non-detach verbs pass through with their output and exit code", { skip: !POSIX }, () => {
  const s = sandbox();
  const ok = s.run(["attach", "-readwrite", "x.dmg"]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /passthrough attach -readwrite x\.dmg/);
  const failed = s.run(["create", "-srcfolder", "x"], { FAKE_CREATE_RC: "3" });
  assert.equal(failed.status, 3);
  assert.match(failed.stdout, /^created: /);
});

test("a detach that works first time does no mitigation", { skip: !POSIX }, () => {
  const s = sandbox();
  const r = s.run(["detach", "/dev/disk4"], { FAKE_DETACH_OK_ON: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.count("hdiutil detach"), 1);
  assert.equal(s.count("pkill") + s.count("mdutil"), 0);
});

// The failure from the Intel run: detach exits 1 ("timeout for DiskArbitration
// expired"), which create-dmg's own retry treats as fatal. The shim keeps going.
test("a DiskArbitration timeout is retried after mitigation instead of failing", { skip: !POSIX }, () => {
  const s = sandbox();
  const r = s.run(["detach", "/dev/disk4"], { FAKE_DETACH_OK_ON: "3" });
  assert.equal(r.status, 0, r.stderr);
  const calls = s.calls();
  assert.ok(s.count("hdiutil detach") >= 2, calls.join("\n"));
  assert.ok(calls.includes("mdutil -i off /Volumes/dmg.test"), "Spotlight is switched off for the mounted volume");
  assert.ok(calls.includes("pkill -9 XProtect"), "XProtect is stopped");
  assert.ok(calls.includes("sync"));
  assert.match(r.stderr, /diagnostics for \/dev\/disk4/);
  assert.match(s.log(), /detached \/dev\/disk4 on attempt/);
});

test("it escalates to diskutil eject, then to detach -force", { skip: !POSIX }, () => {
  const viaDiskutil = sandbox();
  const a = viaDiskutil.run(["detach", "/dev/disk4"], { FAKE_EJECT_WORKS: "1" });
  assert.equal(a.status, 0, a.stderr);
  const calls = viaDiskutil.calls();
  assert.ok(calls.includes("diskutil unmountDisk force /dev/disk4"));
  assert.ok(calls.includes("diskutil eject /dev/disk4"));
  assert.ok(!calls.some((c) => c.startsWith("hdiutil detach -force")), "force is the last resort");

  const viaForce = sandbox();
  const b = viaForce.run(["detach", "/dev/disk4"], { FAKE_DETACH_NEEDS_FORCE: "1" });
  assert.equal(b.status, 0, b.stderr);
  assert.ok(viaForce.calls().includes("hdiutil detach -force /dev/disk4"));
});

test("a device that disappeared despite an error status counts as detached", { skip: !POSIX }, () => {
  const s = sandbox();
  const r = s.run(["detach", "/dev/disk4"], { FAKE_DETACH_VANISHES: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.count("hdiutil detach"), 1);
});

test("when nothing works it exits 1 (not 16) after the configured attempts", { skip: !POSIX }, () => {
  const s = sandbox();
  const r = s.run(["detach", "/dev/disk4"], { DEVHUB_DMG_DETACH_ATTEMPTS: "4" });
  assert.equal(r.status, 1);
  assert.equal(s.count("hdiutil detach"), 3, "two plain attempts plus the final -force; attempt 3 uses diskutil");
  assert.equal(s.count("diskutil eject"), 1);
  assert.match(r.stderr, /giving up on \/dev\/disk4/);
});

test("the time budget stops the ladder early", { skip: !POSIX }, () => {
  const s = sandbox();
  const r = s.run(["detach", "/dev/disk4"], { DEVHUB_DMG_DETACH_ATTEMPTS: "9", DEVHUB_DMG_DETACH_BUDGET: "0" });
  assert.equal(r.status, 1);
  assert.equal(s.count("hdiutil detach"), 1);
});

test("a hung command is killed at the step timeout", { skip: !POSIX }, () => {
  const s = sandbox();
  fs.writeFileSync(
    path.join(s.root, "bin", "hdiutil"),
    `#!/bin/bash\necho "hdiutil $*" >> "$FAKE_STATE/calls"\n[ "$1" = detach ] && exec sleep 30\n[ "$1" = info ] && printf '/dev/disk4\\tGUID_partition_scheme\\t\\n'\nexit 0\n`,
    { mode: 0o755 },
  );
  const started = Date.now();
  const r = s.run(["detach", "/dev/disk4"], { DEVHUB_DMG_STEP_TIMEOUT: "1", DEVHUB_DMG_DETACH_ATTEMPTS: "1" });
  assert.equal(r.status, 1);
  assert.ok(Date.now() - started < 15_000, "did not wait for the 30s sleep");
});

test("--cleanup detaches only DevHub and dmg.* images and always exits 0", { skip: !POSIX }, () => {
  const s = sandbox();
  fs.writeFileSync(
    path.join(s.state, "info.txt"),
    [
      "/dev/disk4\tGUID_partition_scheme\t",
      "/dev/disk4s1\tApple_HFS\t/Volumes/dmg.j4IN3k",
      "/dev/disk7\tGUID_partition_scheme\t",
      "/dev/disk7s1\tApple_HFS\t/Volumes/DevHub",
      "/dev/disk9\tGUID_partition_scheme\t",
      "/dev/disk9s1\tApple_HFS\t/Volumes/Something Else",
      "",
    ].join("\n"),
  );
  // Detach "succeeds" on the first call, but the fake info never changes, so the
  // ladder is allowed to run its course: what matters is which disks it touches.
  const r = s.run(["--cleanup"], { FAKE_DETACH_OK_ON: "1", DEVHUB_DMG_DETACH_ATTEMPTS: "1" });
  assert.equal(r.status, 0, r.stderr);
  const detached = s.calls().filter((c) => c.startsWith("hdiutil detach"));
  assert.deepEqual(detached, ["hdiutil detach -force /dev/disk4", "hdiutil detach -force /dev/disk7"]);
});

test("the workflow installs the shim for Intel only, and keeps Apple Silicon on the stock path", () => {
  const install = workflow.match(/- name: Install resilient hdiutil[\s\S]*?(?=\n      - name: )/);
  assert.ok(install, "install step exists");
  assert.match(install[0], /if: matrix\.target == 'x86_64-apple-darwin'/);
  assert.match(install[0], /hdiutil-resilient\.sh/);
  assert.match(install[0], /GITHUB_PATH/);
  // The Finder-styled Apple Silicon DMG still comes from the unmodified bundler.
  assert.match(workflow, /TAURI_BUNDLER_DMG_IGNORE_CI: \$\{\{ matrix\.target == 'aarch64-apple-darwin' && 'true' \|\| 'false' \}\}/);
});

test("macos_intel_only builds Intel only, skips Windows, and cannot publish", () => {
  assert.match(workflow, /macos_intel_only:\n\s+description:[^\n]+\n\s+required: false\n\s+default: false\n\s+type: boolean/);
  const plan = workflow.match(/\n  plan:[\s\S]*?\n  build:/)?.[0] ?? "";
  assert.match(plan, /macos_intel_only/);
  assert.match(plan, /x86_64-apple-darwin/);
  assert.match(workflow, /strategy:[\s\S]*?matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  for (const job of ["wsl-payload", "publish"]) {
    const body = workflow.match(new RegExp(`\\n  ${job}:[\\s\\S]*?\\n    runs-on:`))?.[0] ?? "";
    assert.match(body, /macos_intel_only/, `${job} must be gated on macos_intel_only`);
  }
  // Dependents of wsl-payload (windows, windows-smoke) are skipped with it.
  assert.match(workflow, /\n  windows:\n[\s\S]*?needs: wsl-payload/);
  assert.match(workflow, /\n  windows-smoke:\n[\s\S]*?needs: windows/);
});

test("the matrix still lists every platform with its args and target", () => {
  const plan = workflow.match(/\n  plan:[\s\S]*?\n  build:/)?.[0] ?? "";
  for (const needle of [
    '"os":"macos-14"',
    '"target":"aarch64-apple-darwin"',
    '"os":"macos-15-intel"',
    '"args":"--verbose --target x86_64-apple-darwin"',
    '"os":"ubuntu-22.04"',
    '"target":"x86_64-unknown-linux-gnu"',
  ]) {
    assert.ok(plan.replaceAll(" ", "").includes(needle.replaceAll(" ", "")), `plan matrix lost ${needle}`);
  }
});
