import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isEntry } from "./is-entry.mjs";

test("isEntry matches through a symlinked directory and escaped characters", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-is-entry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = path.join(root, "real dir #1");
  fs.mkdirSync(real);
  const script = path.join(real, "script.mjs");
  fs.writeFileSync(script, "");
  const link = path.join(root, "link");
  fs.symlinkSync(real, link, "dir");
  const moduleUrl = pathToFileURL(fs.realpathSync(script)).href;
  assert.equal(isEntry(moduleUrl, path.join(link, "script.mjs")), true);
  assert.equal(isEntry(moduleUrl, script), true);
  assert.equal(isEntry(moduleUrl, path.join(root, "other.mjs")), false);
  assert.equal(isEntry(moduleUrl, undefined), false);
});
