import { describe, expect, it } from "vitest";
import { capToolResult, instrumentOutputCap } from "./output-cap.ts";

describe("capToolResult", () => {
  it("leaves results under the limit untouched", () => {
    const result = { content: [{ type: "text", text: "short" }] };
    expect(capToolResult(result, 100)).toBe(result);
  });

  it("truncates text past the limit and says how to get the rest", () => {
    const result = capToolResult({ content: [{ type: "text", text: "x".repeat(500) }] }, 100);
    const text = result.content[0].text;
    expect(text.startsWith("x".repeat(100))).toBe(true);
    expect(text).toContain("truncated to 100 of 500 chars");
    expect(text).toContain("Narrow the call");
  });

  it("spends the budget across parts in order and keeps non-text parts", () => {
    const resource = { type: "resource", resource: { uri: "ui://x", mimeType: "text/html", text: "y".repeat(1000) } };
    const result = capToolResult(
      { content: [{ type: "text", text: "a".repeat(80) }, resource, { type: "text", text: "b".repeat(80) }] },
      100,
    );
    expect(result.content[0]).toEqual({ type: "text", text: "a".repeat(80) });
    expect(result.content[1]).toBe(resource);
    expect((result.content[2] as { text: string }).text.startsWith("b".repeat(20) + "\n\n[DevHub MCP")).toBe(true);
  });
});

describe("instrumentOutputCap", () => {
  function stub() {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _config: unknown, cb: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, cb),
    };
    instrumentOutputCap(server as never, 10);
    return { server, handlers };
  }

  it("caps ordinary tools", async () => {
    const { server, handlers } = stub();
    server.registerTool("repos_git_diff", {}, async () => ({ content: [{ type: "text", text: "z".repeat(50) }] }));
    const out = (await handlers.get("repos_git_diff")!()) as { content: { text: string }[] };
    expect(out.content[0].text).toContain("truncated to 10 of 50");
  });

  it("never truncates verbatim reads an agent writes back", async () => {
    const { server, handlers } = stub();
    server.registerTool("notes_read", {}, async () => ({ content: [{ type: "text", text: "z".repeat(50) }] }));
    const out = (await handlers.get("notes_read")!()) as { content: { text: string }[] };
    expect(out.content[0].text).toBe("z".repeat(50));
  });
});
