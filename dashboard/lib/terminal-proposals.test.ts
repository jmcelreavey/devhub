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
