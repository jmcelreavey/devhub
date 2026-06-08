import { describe, it, expect } from "vitest";
import { isGitNetworkCommand } from "./git-repo-local";

describe("isGitNetworkCommand", () => {
  it("treats fetch, pull, and push as network commands", () => {
    expect(isGitNetworkCommand(["fetch", "origin", "main"])).toBe(true);
    expect(isGitNetworkCommand(["pull", "--rebase", "origin", "main"])).toBe(true);
    expect(isGitNetworkCommand(["push", "origin", "main"])).toBe(true);
  });

  it("treats local commands as non-network", () => {
    expect(isGitNetworkCommand(["status", "--porcelain"])).toBe(false);
    expect(isGitNetworkCommand(["commit", "-m", "msg"])).toBe(false);
    expect(isGitNetworkCommand(["add", "-A"])).toBe(false);
  });
});
