import { afterEach, describe, expect, it } from "vitest";
import { escapeHtml, uiEnabled, uiResult, widgetDocument } from "./ui.ts";

const original = process.env.DEVHUB_MCP_UI;

afterEach(() => {
  if (original === undefined) delete process.env.DEVHUB_MCP_UI;
  else process.env.DEVHUB_MCP_UI = original;
});

describe("uiEnabled", () => {
  it("is off unless explicitly opted into", () => {
    // A capability the user has not asked for must not change what their
    // existing tools return.
    delete process.env.DEVHUB_MCP_UI;
    expect(uiEnabled()).toBe(false);
    process.env.DEVHUB_MCP_UI = "0";
    expect(uiEnabled()).toBe(false);
    process.env.DEVHUB_MCP_UI = "true";
    expect(uiEnabled()).toBe(false);
  });

  it("is on for exactly 1", () => {
    process.env.DEVHUB_MCP_UI = "1";
    expect(uiEnabled()).toBe(true);
  });
});

describe("uiResult", () => {
  it("always emits the text answer first", () => {
    // The entire compatibility story: a client that cannot render the resource
    // still sees exactly what it sees today, and it sees it first.
    process.env.DEVHUB_MCP_UI = "1";
    const result = uiResult("plain answer", "<p>hi</p>", "ui://devhub/x");
    expect(result.content[0]).toEqual({ type: "text", text: "plain answer" });
  });

  it("omits the resource when the seam is off", () => {
    delete process.env.DEVHUB_MCP_UI;
    const result = uiResult("plain answer", "<p>hi</p>", "ui://devhub/x");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });

  it("attaches an html resource when enabled", () => {
    process.env.DEVHUB_MCP_UI = "1";
    const result = uiResult("plain answer", "<p>hi</p>", "ui://devhub/x");
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({
      type: "resource",
      resource: { uri: "ui://devhub/x", mimeType: "text/html", text: "<p>hi</p>" },
    });
  });

  it("degrades to text when a tool has no widget for this case", () => {
    process.env.DEVHUB_MCP_UI = "1";
    expect(uiResult("nothing to show", null, "ui://devhub/x").content).toHaveLength(1);
  });
});

describe("escapeHtml", () => {
  it("neutralises markup", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands before anything else, so entities are not double-formed", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes both quote styles for attribute safety", () => {
    expect(escapeHtml(`a"b'c`)).toBe("a&quot;b&#39;c");
  });
});

describe("widgetDocument", () => {
  it("is a self-contained document with no external references", () => {
    // The client renders this in its own trust context. Anything that reached
    // the network or ran a script would be a content-injection vector via a
    // note title.
    const doc = widgetDocument("Tasks", "<ul></ul>");
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/https?:\/\//);
    expect(doc).not.toMatch(/\bsrc=/i);
  });

  it("escapes the title", () => {
    expect(widgetDocument('</title><script>x</script>', "")).not.toMatch(/<script/i);
  });

  it("adapts to either host theme rather than assuming one", () => {
    expect(widgetDocument("t", "")).toContain("prefers-color-scheme");
  });
});
