import { describe, expect, it } from "vitest";
import { execExternal } from "./exec-external";
import { GhMissingError, GitMissingError, assertGhAvailable, assertGitAvailable, checkGit } from "./setup/git-check";
import { probeDependency, type DependencySpec } from "./setup/dependencies";

describe("execExternal", () => {
  it("explains a missing git instead of surfacing `spawn git ENOENT`", async () => {
    const error = await execExternal("git", ["--version"], { env: { PATH: "" } as unknown as NodeJS.ProcessEnv }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitMissingError);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect((error as Error).message).toMatch(/Git isn't installed/);
  });
  it("leaves other missing programs as they were", async () => {
    const error = await execExternal("devhub-no-such-tool", [], { env: { PATH: "" } as unknown as NodeJS.ProcessEnv }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(GitMissingError);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});

const nodeProbe: DependencySpec = {
  id: "node",
  label: "Node.js",
  required: true,
  unlocks: "Running DevHub",
  bin: process.execPath,
  versionArgs: [],
};

describe("dependency subprocess probes", () => {
  it("passes arguments literally and reports the first nonempty output line", async () => {
    const version = "version $(echo not-a-shell)";
    const result = await probeDependency({
      ...nodeProbe,
      versionArgs: ["-e", "process.stdout.write('\\n' + process.argv[1] + '\\nignored')", "--", version],
    });
    expect(result.present).toBe(true);
    expect(result.version).toBe(version);
  });

  it("reports missing and failing commands as unavailable", async () => {
    const missing = await probeDependency({ ...nodeProbe, bin: "devhub-no-such-probe-binary" });
    const failed = await probeDependency({ ...nodeProbe, versionArgs: ["-e", "process.exit(1)"] });
    expect(missing).toMatchObject({ present: false, version: null });
    expect(failed).toMatchObject({ present: false, version: null });
  });

  it("times out without blocking the event loop", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 10);
    try {
      const result = await probeDependency({ ...nodeProbe, versionArgs: ["-e", "setInterval(() => {}, 1000)"] }, 500);
      expect(result).toMatchObject({ present: false, version: null });
      expect(timerRan).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects unavailable prerequisites before private repo setup", async () => {
    const failingProbe: typeof probeDependency = (spec) => probeDependency({
      ...spec,
      bin: process.execPath,
      versionArgs: ["-e", "process.exit(1)"],
    });
    const git = await checkGit(failingProbe);
    expect(git).toMatchObject({ present: false, version: null });
    await expect(assertGitAvailable(git)).rejects.toBeInstanceOf(GitMissingError);
    await expect(assertGhAvailable(failingProbe)).rejects.toBeInstanceOf(GhMissingError);
  });
});
