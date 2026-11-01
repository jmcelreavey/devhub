import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localOps } from "../../local/ops/index";
import { gitLog } from "./git";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devhub-local-ops-"));
  temporaryDirs.push(dir);
  return { root: dir };
}

describe("local operations", () => {
  it("surfaces Git errors and accepts an unset origin", async () => {
    const { root } = await fixture();
    const oldGlobal = process.env.GIT_CONFIG_GLOBAL;
    const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_CONFIG_GLOBAL = path.join(root, "no-global-git-config");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      await expect(gitLog(root, ["log", "-1"])).rejects.toMatchObject({ code: 128, stderr: expect.any(String) });
      await localOps.git("init", ["-q"], { cwd: root });
      expect(await gitLog(root, ["config", "--get", "remote.origin.url"])).toBe("");
      await expect(gitLog(root, ["not-a-command"])).rejects.toMatchObject({ code: 1, stderr: expect.any(String) });
    } finally {
      if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
      if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    }
  });
});
