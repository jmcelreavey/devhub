import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { repoUpstartCommand } from "./upstart-command";

describe("upstart launcher", () => {
  let tmp: string;
  let main: string;
  let worktree: string;
  let script: string;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "upstart checkout-")));
    main = path.join(tmp, "main repo");
    worktree = path.join(tmp, "linked 'checkout");
    await execExternal("git", ["init", main]);
    await execExternal("git", [
      "-c", "user.name=Test", "-c", "user.email=test@example.com",
      "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture",
    ], { cwd: main });
    await execExternal("git", ["worktree", "add", "--detach", worktree], { cwd: main });
    for (const checkout of [main, worktree]) fs.mkdirSync(path.join(checkout, "src"));
    script = path.join(tmp, "stored 'upstart.sh");
    fs.writeFileSync(script, '#!/bin/bash\nprintf "%s\\n" "$PWD"\ntouch upstart-ran\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each(["main", "worktree"])("launches from the selected %s root with quoted paths", async (checkout) => {
    const root = checkout === "main" ? main : worktree;
    const result = await execExternal("bash", ["-c", repoUpstartCommand(script, path.join(root, "src"))], { cwd: tmp });
    expect(result.stdout.trim()).toBe(root);
    expect(fs.existsSync(path.join(root, "upstart-ran"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/upstart-ran"))).toBe(false);
  });

  it("refuses to run the script outside a git checkout", async () => {
    await expect(execExternal("bash", ["-c", repoUpstartCommand(script, tmp)], { cwd: main })).rejects.toThrow();
    expect(fs.existsSync(path.join(tmp, "upstart-ran"))).toBe(false);
    expect(fs.existsSync(path.join(main, "upstart-ran"))).toBe(false);
  });
});
