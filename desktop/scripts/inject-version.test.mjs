import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";

let root;
let script;
let conf;
let cargo;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-version-"));
  const scripts = path.join(root, "desktop", "scripts");
  const tauri = path.join(root, "desktop", "src-tauri");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(tauri, { recursive: true });
  for (const name of ["inject-version.mjs", "staging-paths.mjs"]) {
    fs.copyFileSync(path.join(import.meta.dirname, name), path.join(scripts, name));
  }
  script = path.join(scripts, "inject-version.mjs");
  conf = path.join(tauri, "tauri.conf.json");
  cargo = path.join(tauri, "Cargo.toml");
  fs.writeFileSync(conf, JSON.stringify({ version: "2.0.0", productName: "DevHub" }));
  fs.writeFileSync(cargo, '[package]\nname = "devhub-desktop"\nversion = "2.0.0"\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test("rebuilding the current release version succeeds repeatedly", () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [script, "2.0.0"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(JSON.parse(fs.readFileSync(conf, "utf8")).version, "2.0.0");
});

test("a release tag updates both manifests", () => {
  const result = spawnSync(process.execPath, [script, "v2.1.0"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(conf, "utf8")).version, "2.1.0");
  assert.match(fs.readFileSync(cargo, "utf8"), /^version = "2.1.0"$/m);
});

test("a missing Cargo version fails without partially updating Tauri", () => {
  fs.writeFileSync(cargo, '[package]\nname = "devhub-desktop"\n');
  const result = spawnSync(process.execPath, [script, "2.1.0"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not find a version line/);
  assert.equal(JSON.parse(fs.readFileSync(conf, "utf8")).version, "2.0.0");
});
