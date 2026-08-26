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

  it("never treats narration as a command", () => {
    // The exact failure mode from the field: the model narrates, then gives
    // the command — only the command may reach the PTY.
    const reply = [
      "Checking what's currently running in the terminals.",
      'The dock tab is idle; checking how "busy" is determined.',
      "ps -o pid,ppid,stat,etime,command -g $(ps -o pgid= -p $$ | tr -d ' '); jobs -l",
    ].join("\n");
    expect(extractShellCommand(reply)).toBe(
      "ps -o pid,ppid,stat,etime,command -g $(ps -o pgid= -p $$ | tr -d ' '); jobs -l",
    );
    // Pure prose is an answer, not a command.
    expect(extractShellCommand("The terminal is idle; nothing is running.")).toBeNull();
    expect(extractShellCommand("Checking the dock.\nAlso checking the prompt.")).toBeNull();
    // Prose plus several command lines is too ambiguous to run.
    expect(extractShellCommand("Try these.\nls\npwd")).toBeNull();
  });

  it("rejects commands with unbalanced quotes (quote> continuation)", () => {
    expect(extractShellCommand("echo 'unterminated")).toBeNull();
    expect(extractShellCommand('```bash\ngrep "half\n```')).toBeNull();
  });

  it("still joins clean multi-line replies", () => {
    expect(extractShellCommand("ls\npwd")).toBe("ls\npwd");
    expect(extractShellCommand("```bash\nfor f in *; do\n  echo $f\ndone\n```")).toBe(
      "for f in *; do\n  echo $f\ndone",
    );
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
