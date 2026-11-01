import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("pre-push content mode only bypasses checks for content-only commits", (context) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-prepush-")));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const bin = path.join(root, "bin");
  const log = path.join(root, "checks.log");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, HOME: root, CHECK_LOG: log, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
  const write = (relative, content) => {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  write("notes/example.md", "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  write("notes/example.md", "content\n");
  git("commit", "-qam", "content");
  const content = git("rev-parse", "HEAD");
  write("apps/ui/code name.ts", "export const value = 1;\n");
  git("add", ".");
  git("commit", "-qm", "code");
  const code = git("rev-parse", "HEAD");
  write("notes/example.md", "more content\n");
  git("commit", "-qam", "more content");
  const mixed = git("rev-parse", "HEAD");

  write(".githooks/pre-push", fs.readFileSync(fileURLToPath(new URL("../.githooks/pre-push", import.meta.url))));
  write("scripts/prepush.sh", fs.readFileSync(fileURLToPath(new URL("./prepush.sh", import.meta.url))));
  write("scripts/check-boundaries.mjs", "");
  write("scripts/prepush.test.mjs", "");
  write("scripts/scan-leaks.sh", "#!/bin/sh\nprintf 'scan\\n' >> \"$CHECK_LOG\"\nexit \"${SCAN_FAIL:-0}\"\n");
  fs.mkdirSync(path.join(repo, "node_modules"));
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$CHECK_LOG\"\n", { mode: 0o755 });

  const run = (local, remote, extra = {}) => {
    fs.writeFileSync(log, "");
    const result = spawnSync("bash", [".githooks/pre-push", "origin", "unused"], {
      cwd: repo,
      env: { ...env, DEVHUB_PREPUSH: "content", ...extra },
      input: `refs/heads/main ${local} refs/heads/main ${remote}\n`,
      encoding: "utf8",
    });
    return { ...result, checks: fs.readFileSync(log, "utf8") };
  };
  const contentOnly = run(content, base);
  assert.equal(contentOnly.status, 0, contentOnly.stderr);
  assert.equal(contentOnly.checks, "scan\n");

  const codePush = run(mixed, base);
  assert.equal(codePush.status, 0, codePush.stderr);
  assert.match(codePush.checks, /scan\n/);
  assert.match(codePush.checks, /run --silent typecheck/);
  assert.match(codePush.checks, /eslint --config apps\/ui\/eslint\.config\.mjs.*code name\.ts/);
  assert.match(codePush.checks, /test:all/);

  const missingCommit = run("f".repeat(40), base);
  assert.notEqual(missingCommit.status, 0);
  assert.equal(missingCommit.checks, "scan\n");
  const failedScan = run(content, base, { SCAN_FAIL: "1" });
  assert.notEqual(failedScan.status, 0);
  assert.equal(failedScan.checks, "scan\n");
  const skipped = run(code, base, { DEVHUB_SKIP_VERIFY: "1" });
  assert.equal(skipped.status, 0);
  assert.equal(skipped.checks, "");
});
