import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceRoot } from "../../../scripts/workspace-paths.mjs";

const currentBin = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolveWorkspaceRoot(currentBin);

function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("MCP bundle follows changed sources", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-paths-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ name: "devhub" }));
  writeFile(root, "packages/shared/package.json", JSON.stringify({ name: "@devhub/shared-actions" }));
  writeFile(root, "package-lock.json", "{}");
  const sharedSource = writeFile(root, "packages/shared/example.ts", 'export const shared = " shared";');
  const transientSharedDir = path.join(root, "packages/shared/transient");
  writeFile(root, "packages/shared/transient/example.ts", "export {};");
  const helper = path.join(root, "scripts/workspace-paths.mjs");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.copyFileSync(path.join(workspaceRoot, "scripts/workspace-paths.mjs"), helper);
  const server = path.join(root, "packages/mcp");
  writeFile(server, "package.json", JSON.stringify({ name: "ai-notes-server" }));
  fs.mkdirSync(path.join(server, "bin"), { recursive: true });
  fs.mkdirSync(path.join(server, "dist"), { recursive: true });
  for (const file of ["devhub-mcp.mjs", "shared-zod.mjs"]) {
    fs.copyFileSync(path.join(currentBin, file), path.join(server, "bin", file));
  }
  fs.symlinkSync(path.join(workspaceRoot, "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const coreSource = writeFile(root, "apps/core/src/example.ts", 'export const suffix = " core";');
  writeFile(server, "src/mcp.ts", 'import { message } from "./message.mjs"; import { suffix } from "../../../apps/core/src/example.ts"; import { shared } from "../../shared/example.ts"; process.stdout.write(message + suffix + shared);');
  const source = writeFile(server, "src/message.mjs", 'export const message = "first";');
  const launcher = path.join(server, "bin/devhub-mcp.mjs");
  const bundle = path.join(server, "dist/mcp.mjs");
  const run = () => spawnSync(process.execPath, [launcher], {
    encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH, HOME: root, REPO_ROOT: root },
  });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "first core shared");
  assert.equal(fs.existsSync(bundle), true);
  const built = fs.statSync(bundle).mtimeMs;
  const unchanged = run();
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(fs.statSync(bundle).mtimeMs, built);
  fs.writeFileSync(source, 'export const message = "changed";');
  const changedAt = new Date(Date.now() + 5000);
  fs.utimesSync(source, changedAt, changedAt);
  const changed = run();
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(changed.stdout, "changed core shared");
  assert.match(fs.readFileSync(bundle, "utf8"), /changed/);

  fs.writeFileSync(coreSource, 'export const suffix = " updated";');
  const coreChangedAt = new Date(Date.now() + 7_500);
  fs.utimesSync(coreSource, coreChangedAt, coreChangedAt);
  const coreChanged = run();
  assert.equal(coreChanged.status, 0, coreChanged.stderr);
  assert.equal(coreChanged.stdout, "changed updated shared");
  fs.utimesSync(coreSource, new Date(0), new Date(0));

  const past = new Date(0);
  fs.utimesSync(source, past, past);
  fs.writeFileSync(sharedSource, 'export const shared = " updated shared";');
  const sharedChangedAt = new Date(Date.now() + 10_000);
  fs.utimesSync(sharedSource, sharedChangedAt, sharedChangedAt);
  const sharedChanged = run();
  assert.equal(sharedChanged.status, 0, sharedChanged.stderr);
  assert.equal(sharedChanged.stdout, "changed updated updated shared");
  fs.utimesSync(sharedSource, past, past);

  const rebuiltAt = fs.statSync(bundle).mtimeMs;
  assert.equal(run().status, 0);
  assert.equal(fs.statSync(bundle).mtimeMs, rebuiltAt);
  fs.rmSync(transientSharedDir, { recursive: true });
  const removedAt = new Date(Date.now() + 12_500);
  fs.utimesSync(path.join(root, "packages/shared"), removedAt, removedAt);
  const removed = run();
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(removed.stdout, "changed updated updated shared");
  assert.notEqual(fs.statSync(bundle).mtimeMs, rebuiltAt);
});

test("stdio launcher reads a scheduler log without a running dashboard", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-stdio-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, ".local/state/devhub/scheduler.log", "fixture abcdef12 ran\n");
  const run = spawnSync(process.execPath, [
    path.join(workspaceRoot, "packages/mcp/scripts/call-tool.mjs"),
    "jobs_log",
    JSON.stringify({ job: "abcdef12" }),
  ], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      HOME: root,
      USERPROFILE: root,
      APPDATA: root,
      LOCALAPPDATA: root,
      TMPDIR: root,
      TEMP: root,
      REPO_ROOT: workspaceRoot,
      NOTES_DIR: path.join(root, "notes"),
      DOCS_DIR: path.join(root, "docs"),
      TASKS_DIR: path.join(root, "tasks"),
      DEVHUB_CONFIG_DIR: path.join(root, "config"),
      DEVHUB_BASE_URL: "http://127.0.0.1:1",
      DEVHUB_MCP_HISTORY: "0",
      DEVHUB_MCP_TOOLSETS: "jobs",
    },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /fixture abcdef12 ran/);
});
