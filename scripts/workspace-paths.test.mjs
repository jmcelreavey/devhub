import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveWorkspacePaths, resolveWorkspaceRoot } from "./workspace-paths.mjs";

function writeFile(root, relative, content = "") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("package paths ignore stale pre-workspace directories", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-workspace-paths-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ name: "devhub" }));
  for (const directory of ["dashboard/node_modules", "desktop/staging", "mcp-servers/devhub-server/bin"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of ["apps/core/src/lib/desktop/build-env.mjs", "apps/desktop/scripts/staging-paths.mjs", "packages/mcp/package.json"]) {
    writeFile(root, file);
  }
  const future = resolveWorkspacePaths(root);
  assert.equal(resolveWorkspaceRoot(path.join(root, "apps/core/src/lib/desktop")), root);
  assert.equal(future.dashboardDir, path.join(root, "apps/ui"));
  assert.equal(future.desktopDir, path.join(root, "apps/desktop"));
  assert.equal(future.mcpDir, path.join(root, "packages/mcp"));
  assert.equal(future.buildEnvFile, path.join(root, "apps/core/src/lib/desktop/build-env.mjs"));
  assert.equal(future.sharedActionsDir, path.join(root, "packages/shared"));

  for (const file of ["dashboard/package.json", "desktop/package.json", "mcp-servers/devhub-server/package.json"]) {
    writeFile(root, file);
  }
  const current = resolveWorkspacePaths(root);
  assert.equal(current.dashboardDir, path.join(root, "apps/ui"));
  assert.equal(current.desktopDir, path.join(root, "apps/desktop"));
  assert.equal(current.mcpDir, path.join(root, "packages/mcp"));
});

test("desktop staging paths load from the future layout", async (context) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-workspace-stage-")));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ name: "devhub" }));
  writeFile(root, "apps/core/src/lib/desktop/build-env.mjs");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL("./workspace-paths.mjs", import.meta.url)), path.join(root, "scripts/workspace-paths.mjs"));
  const stagingFile = path.join(root, "apps/desktop/scripts/staging-paths.mjs");
  fs.mkdirSync(path.dirname(stagingFile), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL("../apps/desktop/scripts/staging-paths.mjs", import.meta.url)), stagingFile);
  const staging = await import(pathToFileURL(stagingFile).href);
  assert.equal(staging.repoRoot, root);
  assert.equal(staging.dashboardDir, path.join(root, "apps/ui"));
  assert.equal(staging.desktopDir, path.join(root, "apps/desktop"));
  assert.equal(staging.buildEnvFile, path.join(root, "apps/core/src/lib/desktop/build-env.mjs"));
});
