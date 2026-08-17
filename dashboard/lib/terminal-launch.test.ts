import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_CLI_DEFAULTS,
  setAgentCliConfigCache,
  type AgentCliConfig,
} from "@/lib/agent/cli-config";
import {
  agentRepoDxAuditCommand,
  agentRepoUpstartCommand,
  agentRepoUpstartDebugCommand,
  agentGitHookFailureCommand,
  agentGitSyncConflictCommand,
  agentLocalCommitReviewCommand,
  agentReviewCommand,
  agentSkillCommand,
  agentStashConflictCommand,
  agentCommitMessageCommand,
  agentStashMessageCommand,
  claudeCliCommand,
  cursorCliCommand,
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

describe("agentSkillCommand", () => {
  it("pins the named vendored skill into a one-shot CLI run", async () => {
    useConfig();
    const command = await agentSkillCommand(
      "commit-archaeologist",
      "Explain why lib/foo.ts exists.",
      "run commit-archaeologist",
    );
    expect(command).toContain("opencode run");
    expect(command).toContain("commit-archaeologist");
    expect(command).toContain("Explain why lib/foo.ts exists.");
  });
});

describe("agentLocalCommitReviewCommand", () => {
  it("writes reviews/<repo>-<date> with a Repo entity link, not a PR url", async () => {
    useConfig();
    process.env.NEXT_PUBLIC_REPO_ROOT = "/repo/devhub";
    const command = await agentLocalCommitReviewCommand("devhub-private", "abc1234", "fix the thing");
    expect(command).toContain("pr-explain-review");
    expect(command).toContain("abc1234");
    expect(command).toContain("Notes MCP path: reviews/devhub-private-");
    expect(command).toContain("Repo entity link");
    expect(command).not.toContain("github.com");
  });
});

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
    useConfig({ opencodeModel: "cursor-acp/cursor-grok-4.5-high" });
    const withModel = await agentReviewCommand("https://github.com/acme/app/pull/1");
    expect(withModel).toContain("opencode run --model 'cursor-acp/cursor-grok-4.5-high'");

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

  it("generates the upstart WITHOUT running it, for both CLIs", async () => {
    /**
     * The inverse of the test that used to live here.
     *
     * This previously asserted the command ended `&& bash <script>` — an agent
     * wrote a shell script and the terminal executed it in the same breath, in
     * the user's repository, with their full environment. There was no moment
     * at which the script existed and had not yet run, so nobody could review
     * it even in principle.
     *
     * Execution now goes through /api/desktop/upstart, which refuses to
     * produce a run command until the exact bytes have been approved (see
     * lib/desktop/upstart-approval.ts). If someone re-chains execution here,
     * this fails and they have to re-derive why it was split.
     */
    const upstartPath = "/repo/devhub/upstarts/acme-app/upstart.sh";
    useConfig();
    const viaOpencode = await agentRepoUpstartCommand("acme-app", upstartPath);
    expect(viaOpencode).not.toContain("&& bash");
    expect(viaOpencode).toContain(upstartPath);
    expect(viaOpencode).not.toContain(".devhub/upstart.sh");

    useConfig({ cli: "cursor" });
    const viaCursor = await agentRepoUpstartCommand("acme-app", upstartPath);
    expect(viaCursor).toContain("cursor-agent -p");
    expect(viaCursor).not.toContain("&& bash");
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

it("hands a conflicted main sync to AI through push and verification", async () => {
  useConfig();
  const command = await agentGitSyncConflictCommand({ repoName: "acme", branch: "feature/foo", syncTarget: "origin/main", stashed: true });
  expect(command).toContain("origin/main");
  expect(command).toContain("push the current branch");
  expect(command).toContain("auto-stash");
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

describe("companion CLI launch commands", () => {
  it("guards the Claude CLI so a missing binary prints a hint", () => {
    const cmd = claudeCliCommand();
    expect(cmd).toContain("command -v");
    expect(cmd).toContain("claude");
    expect(cmd).toContain("Claude CLI not found");
  });

  it("guards cursor-agent so a missing binary prints a hint", () => {
    const cmd = cursorCliCommand();
    expect(cmd).toContain("command -v");
    expect(cmd).toContain("cursor-agent");
    expect(cmd).toContain("Cursor CLI not found");
  });
});
