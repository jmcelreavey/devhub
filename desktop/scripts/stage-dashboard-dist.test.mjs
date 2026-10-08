import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nextDistDir, normalizeStagedDist, rewriteStandaloneConfig, rewriteStagedJavaScript, assertNoStagedDistReferences, relocateDistPaths } from "./stage-dashboard.mjs";

const standalone = fs.readFileSync(new URL("./fixtures/standalone-server.js.txt", import.meta.url), "utf8");
const configOf = (text) => JSON.parse(text.match(/^const nextConfig = (.+)$/m)[1]);

function stagedFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-stage-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".next-rebuild", "server"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next-rebuild", "server", "chunk.js"), 'new AppRouteRouteModule({distDir:".next-rebuild"});');
  const config = { distDir: "./.next-rebuild", distDirRoot: ".next-rebuild", cacheHandler: "./.next-rebuild/cache.cjs", experimental: { cacheHandlers: { remote: ".next-rebuild/remote.cjs" } }, outputFileTracingRoot: "./.next-rebuild/traces" };
  for (const dir of [root, path.join(root, ".next-rebuild")]) {
    fs.writeFileSync(path.join(dir, "required-server-files.json"), JSON.stringify({ config, files: [".next-rebuild/server/chunk.js"] }));
  }
  fs.writeFileSync(path.join(root, "server.js"), standalone);
  fs.writeFileSync(path.join(root, "eslint.config.mjs"), '// Build-only ignore: .next-rebuild');
  fs.writeFileSync(path.join(root, "tsconfig.tsbuildinfo"), 'Build-only cache: .next-rebuild');
  return root;
}

test("next build stays on .next unless a rebuild names a sibling dist dir", () => {
  assert.equal(nextDistDir({}), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next" }), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next-rebuild" }), ".next-rebuild");
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "/tmp/elsewhere" }), /DEVHUB_DIST_DIR/);
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "../.next" }), /DEVHUB_DIST_DIR/);
});

test("real Next 16 standalone shape and route configs run from staged .next", (context) => {
  const root = stagedFixture(context);
  normalizeStagedDist(root, ".next-rebuild");
  assert.equal(fs.existsSync(path.join(root, ".next-rebuild")), false);
  assert.equal(fs.existsSync(path.join(root, "eslint.config.mjs")), false);
  assert.equal(fs.existsSync(path.join(root, "tsconfig.tsbuildinfo")), false);
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.equal(configOf(server).distDir, ".next");
  assert.equal(configOf(server).distDirRoot, ".next");
  assert.equal(server.includes("process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)"), true);
  for (const dir of [root, path.join(root, ".next")]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "required-server-files.json"), "utf8"));
    assert.equal(manifest.config.distDir, ".next");
    assert.equal(manifest.config.distDirRoot, ".next");
    assert.equal(manifest.config.cacheHandler, "./.next/cache.cjs");
    assert.equal(manifest.config.experimental.cacheHandlers.remote, ".next/remote.cjs");
    assert.equal(manifest.config.outputFileTracingRoot, "./.next/traces");
    assert.deepEqual(manifest.files, [".next/server/chunk.js"]);
  }
  assert.equal(fs.readFileSync(path.join(root, ".next", "server", "chunk.js"), "utf8"), 'new AppRouteRouteModule({distDir:".next"});');
  assertNoStagedDistReferences(root, ".next-rebuild");
});

test("unknown text references fail staging rather than shipping broken paths", (context) => {
  const root = stagedFixture(context);
  normalizeStagedDist(root, ".next-rebuild");
  fs.writeFileSync(path.join(root, ".next", "unknown.txt"), "still uses .next-rebuild");
  assert.throws(() => assertNoStagedDistReferences(root, ".next-rebuild"), /unknown.txt/);
});

test("config parsing is structural and rejects unexpected standalone shapes", () => {
  assert.equal(relocateDistPaths("/build/dashboard/.next-rebuild/cache.cjs", ".next-rebuild"), ".next/cache.cjs");
  assert.equal(relocateDistPaths("C:\\build\\dashboard\\.next-rebuild\\cache.cjs", ".next-rebuild"), ".next/cache.cjs");
  assert.throws(() => rewriteStandaloneConfig("const otherConfig = {};", ".next-rebuild"), /nextConfig JSON/);
  assert.throws(() => rewriteStandaloneConfig("const nextConfig = {invalid}", ".next-rebuild"), SyntaxError);
  assert.equal(rewriteStagedJavaScript('const config={distDir:"./.next-rebuild",cache:".next-rebuild/cache"};', ".next-rebuild"), 'const config={distDir:"./.next",cache:".next/cache"};');
  assert.equal(rewriteStagedJavaScript('const unchanged=".next-rebuild-other";', ".next-rebuild"), 'const unchanged=".next-rebuild-other";');
});
