import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_CLI_DEFAULTS,
  setAgentCliConfigCache,
  type AgentCliConfig,
} from "./agent-cli-config";
import {
  agentRepoDxAuditCommand,
  agentRepoUpstartCommand,
  agentRepoUpstartDebugCommand,
  agentGitHookFailureCommand,
  agentReviewCommand,
  agentStashConflictCommand,
  agentCommitMessageCommand,
  agentStashMessageCommand,
} from "./terminal-launch";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setAgentCliConfigCache(null);
});

/** Seed the module cache so builders never hit the (unavailable) API in tests. */
function useConfig(overrides: Partial<AgentCliConfig> = {}) {
  setAgentCliConfigCache({ ...AGENT_CLI_DEFAULTS, ...overrides });
}

describe("agentReviewCommand (opencode)", () => {
  it("runs the pr-explain-review skill against the PR url", async () => {
    useConfig();
    const command = await agentReviewCommand("https://github.com/acme/app/pull/1");
    expect(command).toContain("opencode run");
    expect(command).toContain("pr-explain-review");
    expect(command).toContain("https://github.com/acme/app/pull/1");
  });

  it("pins PR reviews to the DevHub repo notes directory and names the note path", async () => {
    useConfig();
    process.env.NEXT_PUBLIC_REPO_ROOT = "/repo/devhub";

    const command = await agentReviewCommand(
      "https://github.com/acme/app/pull/1",
      "pr-reviews/acme-app-1",
    );

    expect(command).toContain("REPO_ROOT='/repo/devhub' NOTES_DIR='/repo/devhub/notes' opencode run");
    expect(command).toContain("Notes MCP path: pr-reviews/acme-app-1");
    expect(command).toContain("notes_write");
  });

  it("omits the note instruction when no path is given", async () => {
    useConfig();
    const command = await agentReviewCommand("https://github.com/acme/app/pull/1");
    expect(command).not.toContain("notes_write");
  });

  it("passes an OpenCode model override when configured, omits the flag when blank", async () => {
    useConfig({ opencodeModel: "cursor-acp/grok-4.3" });
    const withModel = await agentReviewCommand("https://github.com/acme/app/pull/1");
    expect(withModel).toContain("opencode run --model 'cursor-acp/grok-4.3'");

    useConfig({ opencodeModel: "" });
    const withoutModel = await agentReviewCommand("https://github.com/acme/app/pull/1");
    expect(withoutModel).not.toContain("--model");
  });
});

describe("agent CLI switch (cursor)", () => {
  it("hands one-shot jobs to cursor-agent print mode with the default model", async () => {
    useConfig({ cli: "cursor" });

    const command = await agentReviewCommand("https://github.com/acme/app/pull/1");

    expect(command).toContain("command -v 'cursor-agent'");
    expect(command).toContain("cursor-agent -p ");
    expect(command).toContain("--force --approve-mcps --model 'cursor-grok-4.5-high'");
    expect(command).not.toContain("opencode run");
  });

  it("uses the configured cursor model", async () => {
    useConfig({ cli: "cursor", cursorModel: "composer-2.5" });

    const command = await agentRepoDxAuditCommand("acme-app");

    expect(command).toContain("--model 'composer-2.5'");
  });

  it("still pins REPO_ROOT/NOTES_DIR for note-writing jobs", async () => {
    process.env.NEXT_PUBLIC_REPO_ROOT = "/repo/devhub";
    useConfig({ cli: "cursor" });

    const command = await agentReviewCommand(
      "https://github.com/acme/app/pull/1",
      "pr-reviews/acme-app-1",
    );

    expect(command).toContain("REPO_ROOT='/repo/devhub' NOTES_DIR='/repo/devhub/notes' cursor-agent -p");
  });

  it("chains upstart execution after the one-shot run for both CLIs", async () => {
    const upstartPath = "/repo/devhub/upstarts/acme-app/upstart.sh";
    useConfig();
    const viaOpencode = await agentRepoUpstartCommand("acme-app", upstartPath);
    expect(viaOpencode).toContain(`&& bash '${upstartPath}'`);
    expect(viaOpencode).toContain(upstartPath);
    expect(viaOpencode).not.toContain(".devhub/upstart.sh");

    useConfig({ cli: "cursor" });
    const viaCursor = await agentRepoUpstartCommand("acme-app", upstartPath);
    expect(viaCursor).toContain("cursor-agent -p");
    expect(viaCursor).toContain(`&& bash '${upstartPath}'`);
    expect(viaCursor).not.toContain(".devhub/upstart.sh");
  });

  it("uses an interactive session (no print mode) for upstart debugging", async () => {
    useConfig({ cli: "cursor" });

    const command = await agentRepoUpstartDebugCommand(
      "acme-app",
      "/repo/devhub/upstarts/acme-app/upstart.sh",
    );

    expect(command).toContain("cursor-agent '");
    expect(command).not.toContain("cursor-agent -p");
    expect(command).toContain("/repo/devhub/upstarts/acme-app/upstart.sh");
    expect(command).not.toContain(".devhub/upstart.sh");
  });

  it("prints an install hint when cursor-agent is missing", async () => {
    useConfig({ cli: "cursor" });

    const command = await agentReviewCommand("https://github.com/acme/app/pull/1");

    expect(command).toContain("Cursor CLI not found");
  });
});

describe("agentStashConflictCommand", () => {
  it("launches an interactive opencode session with the conflict skill", async () => {
    useConfig();
    const command = await agentStashConflictCommand({
      repoName: "acme-app",
      branch: "feature/foo",
      conflictFiles: ["src/a.ts", "src/b.ts"],
    });

    expect(command).toContain("opencode ");
    expect(command).toContain("--prompt");
    expect(command).toContain("git-conflict-resolve");
    expect(command).toContain("acme-app");
    expect(command).toContain("feature/foo");
    expect(command).toContain("src/a.ts");
    expect(command).not.toContain("opencode run");
  });

  it("uses interactive cursor-agent (no print mode)", async () => {
    useConfig({ cli: "cursor" });
    const command = await agentStashConflictCommand({
      repoName: "acme-app",
      conflictFiles: ["pkg/x.go"],
    });

    expect(command).toContain("cursor-agent '");
    expect(command).not.toContain("cursor-agent -p");
    expect(command).toContain("git-conflict-resolve");
  });
});

describe("agentCommitMessageCommand", () => {
  it("runs a one-shot commit-message prompt", async () => {
    useConfig();
    const command = await agentCommitMessageCommand("acme-app");
    expect(command).toContain("opencode run");
    expect(command).toContain("acme-app");
    expect(command).toContain("diff --cached");
    expect(command).toContain("Do not commit");
  });
});

describe("agentStashMessageCommand", () => {
  it("runs a one-shot stash-message prompt", async () => {
    useConfig();
    const command = await agentStashMessageCommand("acme-app");
    expect(command).toContain("opencode run");
    expect(command).toContain("acme-app");
    expect(command).toContain("diff HEAD");
    expect(command).toContain("Do not stash");
  });
});

describe("agentGitHookFailureCommand", () => {
  it("launches an interactive session with the hook-fix skill", async () => {
    useConfig();
    const command = await agentGitHookFailureCommand({
      repoName: "devhub-private",
      hook: "pre-push",
      phase: "push",
      logPath: ".git/devhub-hook-failure.log",
    });

    expect(command).toContain("opencode ");
    expect(command).toContain("--prompt");
    expect(command).toContain("git-hook-fix");
    expect(command).toContain("pre-push");
    expect(command).toContain("devhub-hook-failure.log");
    expect(command).toContain("do not skip hooks");
    expect(command).not.toContain("opencode run");
  });

  it("uses interactive cursor-agent (no print mode)", async () => {
    useConfig({ cli: "cursor" });
    const command = await agentGitHookFailureCommand({
      repoName: "acme-app",
      hook: "pre-commit",
      phase: "commit",
    });

    expect(command).toContain("cursor-agent '");
    expect(command).not.toContain("cursor-agent -p");
    expect(command).toContain("git-hook-fix");
  });
});
