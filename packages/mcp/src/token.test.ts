import { describe, expect, it } from "vitest";
import { renderClientConfigs } from "./token.ts";

describe("renderClientConfigs", () => {
  it("prints the endpoint, token, and paste-ready configs", () => {
    const out = renderClientConfigs({ port: 1340, host: "127.0.0.1", token: "tok-123" });
    expect(out).toContain("http://127.0.0.1:1340/mcp");
    expect(out).toContain("Bearer tok-123");
    expect(out).toContain('claude mcp add --transport http devhub');
    expect(out).toContain('"type": "http"');
    expect(out).toContain("DEVHUB_MCP_TOOLSETS");
  });

  it("respects a custom port/host", () => {
    const out = renderClientConfigs({ port: 9999, host: "127.0.0.1", token: "t" });
    expect(out).toContain("http://127.0.0.1:9999/mcp");
  });
});
