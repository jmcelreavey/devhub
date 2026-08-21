import { describe, expect, it } from "vitest";
import {
  agentWorkflows,
  extractRunnableCommands,
  extractShellCommand,
  looksLikeShellCommand,
  previewPromptCommand,
} from "./terminal-prompt";

describe("looksLikeShellCommand", () => {
  it("treats git/ls as commands and questions as chat", () => {
    expect(looksLikeShellCommand("git status")).toBe(true);
    expect(looksLikeShellCommand("ls -la")).toBe(true);
    expect(looksLikeShellCommand("./upstart.sh")).toBe(true);
    expect(looksLikeShellCommand("what failed in the last build")).toBe(false);
    expect(looksLikeShellCommand("explain git status")).toBe(false);
  });
});

describe("extractShellCommand", () => {
  it("unwraps fenced bash and strips $ prompts", () => {
    expect(extractShellCommand("```bash\n$ git status\n```")).toBe("git status");
    expect(extractShellCommand("npm test")).toBe("npm test");
  });

  it("finds runnable fences in a chat reply", () => {
    expect(
      extractRunnableCommands("Try:\n```bash\nrg TODO\n```\nand\n```sh\nls\n```"),
    ).toEqual(["rg TODO", "ls"]);
  });
});

describe("agentWorkflows", () => {
  it("fills review + last-block chips", () => {
    const chips = agentWorkflows({ repoName: "widgets", lastBlock: "Error: boom" });
    expect(chips[0]?.label).toBe("Review this PR");
    expect(chips[0]?.draft).toContain("widgets");
    expect(chips.find((c) => c.id === "error")?.draft).toContain("Error: boom");
    expect(previewPromptCommand("x".repeat(80)).endsWith("…")).toBe(true);
  });
});
