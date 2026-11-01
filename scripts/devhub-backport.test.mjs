import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("snapshot removes retired public paths without exporting private files", (context) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-backport-")));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const publicRepo = path.join(root, "public");
  const privateRepo = path.join(root, "private");
  fs.mkdirSync(publicRepo);
  fs.mkdirSync(privateRepo);
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const write = (repo, relative, content) => {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  for (const repo of [publicRepo, privateRepo]) {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Fixture");
    git(repo, "config", "user.email", "fixture@example.invalid");
  }
  write(publicRepo, "README.md", "old\n");
  write(publicRepo, "dashboard/old.txt", "retired\n");
  write(publicRepo, "notes/.gitkeep", "placeholder\n");
  git(publicRepo, "add", ".");
  git(publicRepo, "commit", "-qm", "public");
  write(privateRepo, "README.md", "new\n");
  write(privateRepo, "notes/example.txt", "private fixture\n");
  write(privateRepo, "scripts/devhub-backport.sh", fs.readFileSync(fileURLToPath(new URL("./devhub-backport.sh", import.meta.url))));
  write(privateRepo, "scripts/lib/git-lock.sh", "setup_git_lock() { :; }\ncleanup_git_lock() { :; }\ngit_write() { git \"$@\"; }\n");
  write(privateRepo, "scripts/lib/public-paths.sh", "PUBLIC_PATHS=(README.md)\nPERSONAL_PATHS=(notes)\n");
  write(privateRepo, "scripts/scan-leaks.sh", "exit 0\n");
  git(privateRepo, "add", ".");
  git(privateRepo, "commit", "-qm", "private");
  git(privateRepo, "remote", "add", "upstream", publicRepo);
  const result = spawnSync("bash", ["scripts/devhub-backport.sh", "HEAD", "--snapshot", "--patch-only"], {
    cwd: privateRepo,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /diff --git a\/dashboard\/old\.txt/);
  assert.match(result.stdout, /diff --git a\/notes\/\.gitkeep/);
  assert.match(result.stdout, /\+new/);
  assert.doesNotMatch(result.stdout, /private fixture/);
});
