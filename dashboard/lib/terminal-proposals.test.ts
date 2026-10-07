import { describe, expect, it, vi } from "vitest";
import { createTerminalProposal, subscribeToTerminalProposals } from "@/lib/terminal-proposals";

describe("subscribeToTerminalProposals", () => {
  it("notifies on create and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTerminalProposals(listener);

    createTerminalProposal({ command: "echo one" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    createTerminalProposal({ command: "echo two" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("drops a listener that throws without failing the create", () => {
    const broken = vi.fn(() => {
      throw new Error("closed stream");
    });
    subscribeToTerminalProposals(broken);

    expect(() => createTerminalProposal({ command: "echo three" })).not.toThrow();
    createTerminalProposal({ command: "echo four" });
    expect(broken).toHaveBeenCalledTimes(1);
  });
});


describe("automatic terminal runs", () => {
  it("automatically launches ordinary MCP commands", () => {
    const proposal = createTerminalProposal({ command: "npm run ios", source: "mcp", autoRunConfirmed: true });
    expect(proposal.autoRun).toBe(true);
    expect(proposal.status).toBe("pending");
  });

  it("keeps destructive-command confirmation even when automatic execution is requested", () => {
    const proposal = createTerminalProposal({ command: "rm -rf /tmp/example", source: "mcp", autoRunConfirmed: true });
    expect(proposal.destructive).toBe(true);
    expect(proposal.autoRun).toBe(false);
  });
});
