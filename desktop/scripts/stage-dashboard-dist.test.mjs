import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nextDistDir, normalizeStagedDist, rewriteDistDirText } from "./stage-dashboard.mjs";

test("next build stays on .next unless a rebuild names a sibling dist dir", () => {
  assert.equal(nextDistDir({}), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next" }), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next-rebuild" }), ".next-rebuild");
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "/tmp/elsewhere" }), /DEVHUB_DIST_DIR/);
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "../.next" }), /DEVHUB_DIST_DIR/);
});

test("a rebuild dist dir is staged as .next, which is what the runtime starts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-stage-"));
  const custom = path.join(root, ".next-rebuild", "server");
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, "chunk.js"), "ok");
  fs.writeFileSync(path.join(root, ".next-rebuild", "required-server-files.json"), '{"config":{"distDir":".next-rebuild"}}\n');
  fs.writeFileSync(path.join(root, "server.js"), 'const config = {"distDir":".next-rebuild"};\n');
  fs.mkdirSync(path.join(root, ".next", "static"), { recursive: true });
  normalizeStagedDist(root, ".next-rebuild");
  assert.equal(fs.readFileSync(path.join(root, ".next", "server", "chunk.js"), "utf8"), "ok");
  assert.equal(fs.existsSync(path.join(root, ".next-rebuild")), false);
  assert.equal(fs.readFileSync(path.join(root, "server.js"), "utf8").includes('{"distDir":".next"}'), true);
  assert.equal(fs.readFileSync(path.join(root, ".next", "required-server-files.json"), "utf8").includes('{"distDir":".next"}'), true);
  assert.equal(rewriteDistDirText('{"distDir":".next"}', ".next-rebuild", ".next"), '{"distDir":".next"}');
  fs.rmSync(root, { recursive: true, force: true });
});
