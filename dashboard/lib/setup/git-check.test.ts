import { afterEach, describe, expect, it, vi } from "vitest";
import type { DependencyStatus } from "./dependencies";
import { GitMissingError, assertGitAvailable, checkGit } from "./git-check";

const status = (patch: Partial<DependencyStatus>): DependencyStatus => ({
  id: "git", label: "Git", required: true, unlocks: "", present: false, version: null, ...patch,
});
afterEach(() => vi.unstubAllEnvs());

describe("checkGit", () => {
  it("reports an installed git with its version", () => {
    expect(checkGit(() => status({ present: true, version: "git version 2.43.0" }))).toMatchObject({ present: true, version: "git version 2.43.0" });
  });
  it("names the WSL distro as the place to run the install command", () => {
    vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
    expect(checkGit(() => status({ installCommand: "sudo apt-get update && sudo apt-get install -y git" })).where).toBe("Ubuntu (WSL terminal)");
  });
  it("passes the machine-specific install command through", () => {
    const check = checkGit((spec) => status({ installCommand: spec.installCommand, installUrl: spec.installUrl }));
    expect(check.installUrl).toBe("https://git-scm.com/downloads");
    if (process.platform === "darwin") expect(check.installCommand).toBe("xcode-select --install");
  });
});

describe("assertGitAvailable", () => {
  const missing = { present: false, version: null, where: "Ubuntu (WSL terminal)", installCommand: "sudo apt-get update && sudo apt-get install -y git", installUrl: "https://git-scm.com/downloads" };
  it("explains how to install git instead of letting a spawn error through", () => {
    expect(() => assertGitAvailable(missing)).toThrow(GitMissingError);
    expect(() => assertGitAvailable(missing)).toThrow(/sudo apt-get update && sudo apt-get install -y git/);
  });
  it("falls back to the download page when no command fits the platform", () => {
    expect(() => assertGitAvailable({ ...missing, installCommand: null })).toThrow(/git-scm\.com/);
  });
  it("does nothing when git is present", () => {
    expect(() => assertGitAvailable({ ...missing, present: true })).not.toThrow();
  });
});
