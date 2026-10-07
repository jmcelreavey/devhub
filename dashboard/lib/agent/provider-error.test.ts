import { describe, expect, it } from "vitest";
import { describeProviderError } from "./provider-error";

const ansiMcp = "\u001b[91m\u001b[1mError: \u001b[0mConfiguration is invalid at ~/.config/opencode/opencode.json\n↳ Invalid input mcp.devhub";

describe("describeProviderError", () => {
  it("strips terminal colour codes from the log", () => {
    const view = describeProviderError("OpenCode", ansiMcp);
    expect(view.log).not.toMatch(/\u001b|\[91m/);
    expect(view.log.startsWith("Error: Configuration is invalid")).toBe(true);
  });
  it("leads with a one-line summary for an invalid DevHub MCP entry", () => {
    const view = describeProviderError("OpenCode", ansiMcp);
    expect(view.kind).toBe("opencode-mcp");
    expect(view.summary).toBe("OpenCode's DevHub MCP entry is invalid.");
    expect(view.summary).not.toContain("\n");
  });
  it("asks for a Cursor sign-in with the exact command", () => {
    const view = describeProviderError("Cursor", "Authentication required. Please run 'agent login'");
    expect(view.kind).toBe("cursor-login");
    expect(view.hint).toContain("`agent login`");
  });
  it("shows a short unclassified error as is, and summarises a long one", () => {
    expect(describeProviderError("Codex", "spawn codex ENOENT").summary).toBe("spawn codex ENOENT");
    expect(describeProviderError("Codex", `line one\n${"x".repeat(300)}`).summary).toBe("Codex couldn't start.");
  });
  describe("Pi install hint", () => {
    it("applies to Pi", () => {
      expect(describeProviderError("Pi", "ENOENT: mkdir lib/node_modules").kind).toBe("pi-prefix");
      expect(describeProviderError("Agent", "npm install -g pi-rustdex failed: ENOENT").kind).toBe("pi-prefix");
    });
    it("does not catch unrelated providers or words containing 'pi'", () => {
      expect(describeProviderError("GitHub Copilot", "ENOENT: no such file or directory, api pipe").kind).toBe("generic");
      expect(describeProviderError("Codex", "spawn codex ENOENT: prefix").kind).toBe("generic");
    });
  });
});
