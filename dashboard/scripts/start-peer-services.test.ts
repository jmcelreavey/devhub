import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(__dirname, "start-peer-services.ts"), "utf8");

describe("start-peer-services boot", () => {
  it("does not start always-on OpenCode or OpenChamber", () => {
    expect(source).not.toMatch(/\bstartOpenCodePeer\b/);
    expect(source).not.toMatch(/\bstartChamberPeer\b/);
    expect(source).not.toMatch(/\bkeepPeerProcessAlive\b/);
    expect(source).not.toMatch(/OPENCODE_SKIP_START/);
    expect(source).toMatch(/freePinnedOpenCodePorts/);
  });
});
