import { describe, expect, it } from "vitest";
import {
  formatTerminalInjectPayload,
  isDestructiveTerminalCommand,
  isTerminalBusy,
  wrapQuietAgentRun,
  wrapStructuredTerminalRun,
} from "./terminal-inject";
import { applyCliTokenBudget } from "./ai/cli-runner";
import {
  TERMINAL_TAB_TEMPLATES,
  formatTerminalTabLabel,
  isAgentLikeKind,
  parseTerminalSessionKind,
} from "./terminal-meta";
import {
  formatTerminalCaptureMarkdown,
  lastTerminalBlock,
  terminalCaptureNotePath,
} from "./terminal-capture";
import {
  createTerminalProposal,
  getTerminalProposal,
  listTerminalProposals,
  resolveTerminalProposal,
} from "./terminal-proposals";
import {
  findTabForOpen,
  formatProposePreview,
  parsePersistedDockState,
  previewTerminalCommand,
  shouldExpandOnTerminalOpen,
} from "./terminal-dock-state";
import {
  cliUnavailableMessage,
  formatAgentJobSummary,
  formatAgentStatusLine,
  providerDisplayName,
} from "./agent-status";

describe("terminal-inject", () => {
  it("flags destructive patterns", () => {
    expect(isDestructiveTerminalCommand("rm -rf /tmp/foo")).toBe(true);
    expect(isDestructiveTerminalCommand("git push --force origin main")).toBe(true);
    expect(isDestructiveTerminalCommand("npm test")).toBe(false);
  });

  it("uses a quiet window for busy/idle", () => {
    expect(isTerminalBusy({ lastOutputAt: null, lastInputAt: null, now: 10_000 })).toBe(false);
    expect(isTerminalBusy({ lastOutputAt: 9_500, lastInputAt: null, now: 10_000, idleMs: 1_200 })).toBe(
      true,
    );
    expect(isTerminalBusy({ lastOutputAt: 8_000, lastInputAt: null, now: 10_000, idleMs: 1_200 })).toBe(
      false,
    );
  });

  it("wraps one-shots with banner + exit code", () => {
    const wrapped = wrapStructuredTerminalRun("echo hi", { title: "DevHub run" });
    expect(wrapped).toContain("DevHub run");
    expect(wrapped).toContain("echo hi");
    expect(wrapped).toContain("_dh_ec");
  });

  it("quiet agent runs group the command without CLI banners or a second clear", () => {
    const quiet = wrapQuietAgentRun("cursor-agent -p 'huge'");
    expect(quiet).toContain("cursor-agent -p 'huge'");
    expect(quiet).toContain("{ ");
    expect(quiet).not.toContain("──");
    expect(quiet).not.toContain("_dh_ec");
    expect(quiet).not.toContain("033[2J");
  });

  it("uses bracketed paste for multi-line inject payloads", () => {
    const single = formatTerminalInjectPayload("echo hi");
    expect(single).toBe("echo hi\r");
    const multi = formatTerminalInjectPayload("echo one\necho two");
    expect(multi.startsWith("\x1b[200~")).toBe(true);
    expect(multi.endsWith("\x1b[201~\r")).toBe(true);
    expect(multi).toContain("echo one\necho two");
  });
});

describe("applyCliTokenBudget", () => {
  it("appends an output-budget instruction and clips oversized prompts", () => {
    expect(applyCliTokenBudget("short", undefined)).toBe("short");
    const instructed = applyCliTokenBudget("short", 128);
    expect(instructed).toContain("Keep the response under ~128 tokens");
    const huge = "x".repeat(200_000);
    const clipped = applyCliTokenBudget(huge, 4096);
    expect(clipped.length).toBeLessThan(huge.length);
    expect(clipped).toContain("prompt truncated for CLI token budget");
  });
});

describe("terminal-meta", () => {
  it("formats tab labels with kind prefix", () => {
    expect(formatTerminalTabLabel({ kind: "agent", repoName: "widgets" })).toBe("Agent · widgets");
    expect(formatTerminalTabLabel({ kind: "review", repoName: "widgets" })).toBe("Review · widgets");
    expect(formatTerminalTabLabel({ label: "custom" })).toBe("custom");
    expect(isAgentLikeKind("agent")).toBe(true);
    expect(isAgentLikeKind("shell")).toBe(false);
    expect(parseTerminalSessionKind("review")).toBe("review");
    expect(parseTerminalSessionKind("capture")).toBe("capture");
    expect(parseTerminalSessionKind("nope")).toBeUndefined();
  });

  it("drops unknown kinds when restoring persisted dock state", () => {
    const state = parsePersistedDockState(
      JSON.stringify({
        tabs: [{ id: 1, label: "zsh", kind: "not-a-kind" }],
        activeId: 1,
        nextId: 2,
        open: false,
        userCollapsed: false,
      }),
    );
    expect(state?.tabs[0]?.kind).toBeUndefined();
  });
});

describe("terminal-capture", () => {
  it("builds a stable note path and markdown", () => {
    expect(terminalCaptureNotePath("App Poc", "2026-08-20")).toBe("terminal/app-poc-2026-08-20");
    const md = formatTerminalCaptureMarkdown({
      label: "app-poc",
      cwd: "/Users/jm/Developer/app-poc",
      body: "\u001b[31mred\u001b[0m\nhello\n",
    });
    expect(md).toContain("# Terminal · app-poc");
    expect(md).toContain("hello");
    expect(md).not.toContain("\u001b");
    expect(lastTerminalBlock("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("lengthens the fence when body contains triple backticks", () => {
    const md = formatTerminalCaptureMarkdown({
      label: "demo",
      body: "before\n```js\ncode\n```\nafter",
    });
    expect(md).toContain("````text\n");
    expect(md).toContain("\n````\n");
    expect(md).toContain("```js\ncode\n```");
  });
});

describe("terminal-proposals", () => {
  it("creates and resolves proposals without auto-inject", () => {
    const p = createTerminalProposal({
      command: "echo hello",
      label: "agent · demo",
      kind: "agent",
      source: "mcp",
      reason: "test",
    });
    expect(p.status).toBe("pending");
    expect(p.destructive).toBe(false);
    expect(listTerminalProposals({ status: "pending" }).some((x) => x.id === p.id)).toBe(true);
    resolveTerminalProposal(p.id, "approve", { finalCommand: "echo hi" });
    expect(getTerminalProposal(p.id)?.status).toBe("approved");
    expect(getTerminalProposal(p.id)?.finalCommand).toBe("echo hi");
    resolveTerminalProposal(p.id, "injected");
    expect(getTerminalProposal(p.id)?.status).toBe("injected");
  });

  it("marks destructive proposals", () => {
    const p = createTerminalProposal({ command: "sudo rm -rf /tmp/x", source: "mcp" });
    expect(p.destructive).toBe(true);
  });

  it("lists pending FIFO and supports failed status", () => {
    const a = createTerminalProposal({ command: "echo a", source: "mcp" });
    const b = createTerminalProposal({ command: "echo b", source: "mcp" });
    const pending = listTerminalProposals({ status: "pending" }).filter(
      (p) => p.id === a.id || p.id === b.id,
    );
    expect(pending.map((p) => p.id)).toEqual([a.id, b.id]);
    resolveTerminalProposal(a.id, "failed", { error: "busy timeout" });
    expect(getTerminalProposal(a.id)?.status).toBe("failed");
    expect(getTerminalProposal(a.id)?.error).toBe("busy timeout");
  });

  it("does not let injected overwrite denied", () => {
    const p = createTerminalProposal({ command: "echo nope", source: "mcp" });
    resolveTerminalProposal(p.id, "deny");
    resolveTerminalProposal(p.id, "injected");
    expect(getTerminalProposal(p.id)?.status).toBe("denied");
  });
});

describe("terminal-dock-state metadata", () => {
  it("persists kind and repoName", () => {
    const state = parsePersistedDockState(
      JSON.stringify({
        tabs: [
          {
            id: 1,
            label: "agent · widgets",
            cwd: "/Users/jm/Developer/widgets",
            sessionId: "11111111-1111-1111-1111-111111111111",
            kind: "agent",
            repoName: "widgets",
          },
        ],
        activeId: 1,
        nextId: 2,
        open: true,
        userCollapsed: false,
      }),
    );
    expect(state?.tabs[0]?.kind).toBe("agent");
    expect(state?.tabs[0]?.repoName).toBe("widgets");
    expect(shouldExpandOnTerminalOpen({ userCollapsed: true })).toBe(false);
  });
});

describe("findTabForOpen", () => {
  const devserver = {
    id: 1,
    label: "Dev",
    kind: "devserver" as const,
    cwd: "/repo",
    repoName: "widgets",
    status: "open",
  };
  const agent = {
    id: 2,
    label: "Agent · widgets",
    kind: "agent" as const,
    cwd: "/repo",
    repoName: "widgets",
    status: "open",
  };

  it("never reuses a dedicated tab when preferAgentTab", () => {
    expect(
      findTabForOpen([devserver], {
        cwd: "/repo",
        repoName: "widgets",
        preferAgentTab: true,
        kind: "agent",
      }),
    ).toBeNull();
  });

  it("reuses an idle agent tab", () => {
    expect(
      findTabForOpen([devserver, agent], {
        cwd: "/repo",
        repoName: "widgets",
        preferAgentTab: true,
        kind: "agent",
      })?.id,
    ).toBe(2);
  });

  it("keeps upstart on upstart tabs only", () => {
    expect(
      findTabForOpen([agent], {
        cwd: "/repo",
        repoName: "widgets",
        preferAgentTab: true,
        kind: "upstart",
      }),
    ).toBeNull();
  });

  it("truncates giant command previews", () => {
    expect(previewTerminalCommand("x".repeat(400)).endsWith("…")).toBe(true);
    expect(previewTerminalCommand("short")).toBe("short");
  });

  it("omits Review and Expo from dock templates", () => {
    expect(TERMINAL_TAB_TEMPLATES.map((t) => t.id)).toEqual(["shell", "agent"]);
    expect(TERMINAL_TAB_TEMPLATES.some((t) => t.kind === "devserver")).toBe(false);
    expect(TERMINAL_TAB_TEMPLATES.some((t) => t.kind === "review")).toBe(false);
  });

  it("prefers friendly propose previews over raw CLI", () => {
    expect(
      formatProposePreview({
        command: "cursor-agent -p 'huge prompt' --force",
        summary: "Review PR #123 with Cursor",
      }),
    ).toBe("Review PR #123 with Cursor");
    expect(
      formatProposePreview({
        command: "cursor-agent -p 'x'",
        label: "DX audit · widgets",
      }),
    ).toBe("DX audit · widgets");
    expect(formatProposePreview({ command: "echo hi" })).toBe("echo hi");
  });

  it("formats agent job summaries with provider", () => {
    expect(providerDisplayName("cursor")).toBe("Cursor");
    expect(
      formatAgentJobSummary({
        title: "Review PR #123",
        provider: "cursor",
        kind: "review",
      }),
    ).toBe("Review PR #123 · Cursor");
    expect(
      formatAgentJobSummary({
        title: "DX audit · widgets",
        provider: "chatgpt",
        kind: "review",
      }),
    ).toBe("DX audit · widgets · ChatGPT");
    expect(
      formatAgentJobSummary({
        title: "Chat with Cursor",
        provider: "cursor",
        summary: "Chat with Cursor",
      }),
    ).toBe("Chat with Cursor");
  });

  it("formats agent status lines for the dock strip", () => {
    expect(formatAgentStatusLine({ phase: "starting", providerLabel: "Cursor" })).toBe(
      "Cursor · starting",
    );
    expect(
      formatAgentStatusLine({
        phase: "running",
        summary: "Review PR #123 · Cursor",
      }),
    ).toBe("Review PR #123 · Cursor");
    expect(formatAgentStatusLine({ phase: "ready", providerLabel: "ChatGPT" })).toBe(
      "ChatGPT · ready",
    );
    expect(formatAgentStatusLine({ phase: "done", summary: "DX audit · widgets" })).toBe(
      "DX audit · widgets",
    );
    expect(formatAgentStatusLine({ phase: "failed", providerLabel: "Cursor" })).toBe(
      "Cursor isn’t available",
    );
    expect(
      formatAgentStatusLine({
        phase: "failed",
        summary: cliUnavailableMessage("cursor"),
      }),
    ).toBe("Cursor isn’t installed. Pick another provider in Setup.");
  });


  it("prefers same kind for plain shell opens", () => {
    const shell = {
      id: 3,
      label: "widgets",
      kind: "shell" as const,
      cwd: "/repo",
      repoName: "widgets",
      status: "open",
    };
    expect(
      findTabForOpen([agent, shell], {
        cwd: "/repo",
        repoName: "widgets",
        kind: "shell",
      })?.id,
    ).toBe(3);
  });

  it("reuses dedicated tabs instead of dueling on a port", () => {
    expect(
      findTabForOpen([devserver], {
        label: "Dev",
        kind: "devserver",
        command: "npm run dev",
      })?.id,
    ).toBe(1);
  });

  it("does not reuse interactive agent tabs for inject", () => {
    expect(
      findTabForOpen([{ ...agent, lastMode: "interactive" }], {
        cwd: "/repo",
        repoName: "widgets",
        preferAgentTab: true,
        kind: "agent",
      }),
    ).toBeNull();
  });
});
