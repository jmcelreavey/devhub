import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-updater-manifest.mjs");

function run(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-manifest-"));
  for (const name of files) fs.writeFileSync(path.join(dir, name), name.endsWith(".sig") ? "sig\n" : "bin");
  const result = spawnSync(process.execPath, [script, dir, "2.1.0"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "o/r", GITHUB_REF_NAME: "v2.1.0" },
  });
  const manifestPath = path.join(dir, "latest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, manifest };
}

test("lists the Windows NSIS installer under windows-x86_64", () => {
  const { result, manifest } = run(["DevHub_2.1.0_x64-setup.exe", "DevHub_2.1.0_x64-setup.exe.sig"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(manifest.platforms), ["windows-x86_64"]);
  assert.match(manifest.platforms["windows-x86_64"].url, /DevHub_2\.1\.0_x64-setup\.exe$/);
});

test("refuses a Windows installer with no signature", () => {
  const { result } = run(["DevHub_2.1.0_x64-setup.exe"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No signature/);
});
