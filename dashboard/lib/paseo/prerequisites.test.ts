import { describe, expect, it } from "vitest";
import { agentBlocker, agentSetupMessage, safeChainRowState } from "./prerequisites";

const ready = { node: true, npm: true, safeChain: true, paseoRunning: true };

describe("agent prerequisites", () => {
  it("disables Safe-Chain install until npm is present", () => {
    const blocked = safeChainRowState(false);
    expect(blocked.enabled).toBe(false);
    expect(blocked.hint).toMatch(/Install Node.js first/);
    expect(blocked.hint).toMatch(/Node\.js, then Safe-Chain, then Paseo/);
    expect(blocked.downloadUrl).toBe("https://nodejs.org/en/download");
    expect(safeChainRowState(true)).toEqual({ enabled: true, hint: null, downloadUrl: null });
  });

  it("names the missing prerequisite and hides the daemon URL from the desktop app", () => {
    expect(agentBlocker({ ...ready, node: false, npm: false, safeChain: false, paseoRunning: false })).toBe("node");
    const node = agentSetupMessage({ ...ready, node: false, paseoRunning: false });
    expect(node.message).toMatch(/Install Node.js first/);
    expect(node.detail).toBeNull();
    expect(node.message).not.toMatch(/DEVHUB_PASEO_URL/);
    const chain = agentSetupMessage({ ...ready, safeChain: false, paseoRunning: false }, { checkout: true });
    expect(chain.message).toMatch(/Safe-Chain isn't installed/);
    expect(chain.detail).toMatch(/DEVHUB_PASEO_URL/);
    const down = agentSetupMessage({ ...ready, paseoRunning: false }, { checkout: true });
    expect(down.message).toMatch(/isn't set up or isn't running/);
    expect(down.setupHref).toBe("/setup?step=tools");
    expect(agentSetupMessage(ready).message).toBe("");
  });
});
