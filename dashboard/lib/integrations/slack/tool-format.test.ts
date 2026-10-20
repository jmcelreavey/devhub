import { describe, expect, it } from "vitest";
import type { SlackTool } from "./mcp-catalog";
import { argsPreview, describeArgs, formatChoiceCard, formatConfirmCard, formatPickCard, formatTooLargeCard, formatToolResult, readableResult, resultUrl } from "./tool-format";

const base = "http://localhost:1337";
const t = (patch: Partial<SlackTool> = {}): SlackTool => ({ name: "notes_delete", description: "Delete a note", inputSchema: {}, readOnly: false, destructive: false, category: "notes", ...patch });

describe("tool result formatting", () => {
  it("uses a same-origin result link or the tool group's page", () => {
    expect(resultUrl(JSON.stringify({ href: "/storyboard?task=1" }), base)).toBe("http://localhost:1337/storyboard?task=1");
    expect(resultUrl(JSON.stringify([{ url: "https://evil.example/x" }]), base)).toBeUndefined();
    expect(resultUrl("not json", base)).toBeUndefined();
    const withLink = formatToolResult({ tool: "x", text: JSON.stringify({ url: "/tasks" }), channel: "C", profile: "work", baseUrl: base });
    expect(JSON.stringify(withLink.blocks)).toContain("Open in DevHub");
    const without = formatToolResult({ tool: "x", text: "plain", channel: "C", profile: "work", baseUrl: base });
    expect(JSON.stringify(without.blocks)).toContain('"url":"http://localhost:1337/"');
  });
  it("never exceeds Slack's section limit and escapes the fallback text", () => {
    const message = formatToolResult({ tool: "x", text: "<b>&".repeat(5000), channel: "C", profile: "work", baseUrl: base });
    expect((message.blocks![0] as { text: { text: string } }).text.text.length).toBeLessThanOrEqual(3000);
    expect(message.text).not.toMatch(/[<>]/);
  });
  it("marks an error result and handles empty output", () => {
    expect(formatToolResult({ tool: "x", text: "boom", isError: true, channel: "C", profile: "work" }).text).toContain("Couldn't load that");
    expect(readableResult("  ")).toBe("Done. The tool returned nothing.");
  });
  it("lists details briefly", () => {
    expect(describeArgs({})).toBe("no details");
    expect(describeArgs({ a: "x", b: [1] })).toBe("a: x\nb: [1]");
  });
  it("builds confirm and pick cards with the right buttons", () => {
    const confirm = formatConfirmCard({ tool: t({ destructive: true }), args: { path: "a" }, id: "id1", channel: "C", profile: "work" });
    expect(JSON.stringify(confirm.blocks)).toContain("devhub_tool_confirm");
    expect(confirm.blocks?.find((block) => block.type === "actions")).toMatchObject({ elements: [{ style: "danger" }, { text: { text: "Cancel" } }] });
    expect(confirm.text).toContain("This can't be undone.");
    const pick = formatPickCard({ choices: [1, 2, 3, 4].map((n) => ({ tool: t({ name: `t${n}` }), id: `i${n}` })), channel: "C" });
    const elements = (pick.blocks![1] as { elements: Array<{ action_id: string }> }).elements;
    expect(elements.map((element) => element.action_id)).toEqual(["devhub_tool_pick_1", "devhub_tool_pick_2", "devhub_tool_pick_3"]);
  });
  it("does not show internal errors, stack traces or codes", () => {
    const message = formatToolResult({ tool: "prs_list", text: "E_PRIVATE: secret-token\n at /Users/private/file.ts:3", isError: true, channel: "C", profile: "work", baseUrl: base });
    expect(JSON.stringify(message)).not.toMatch(/E_PRIVATE|secret-token|Users\/private/);
    expect(message.text).toContain("check the result before trying again");
  });
  it("offers Setup rather than exposing an authentication error", () => {
    const message = formatToolResult({ tool: "calendar_week", text: "Google Calendar needs reconnecting", isError: true, channel: "C", profile: "work", baseUrl: base });
    expect(message.text).toContain("Check the connection in Setup");
    expect(JSON.stringify(message.blocks)).toContain('"url":"http://localhost:1337/setup"');
  });
});

const texts = (message: { blocks?: unknown[] }) => (message.blocks as Array<{ type: string; text?: { text: string } }>).filter((block) => block.type === "section").map((block) => block.text!.text);

describe("confirm preview shows what is being approved", () => {
  it("shows every key and a long value in full, split under Slack's block limit", () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} of the document`).join("\n");
    const card = formatConfirmCard({ tool: t({ name: "docs_write" }), args: { path: "runbook.md", content: body, mode: "overwrite" }, id: "id1", channel: "C", profile: "work" });
    const shown = texts(card).join("\n");
    expect(shown).toContain("path: runbook.md");
    expect(shown).toContain("mode: overwrite");
    expect(shown).toContain("line 399 of the document");
    expect(shown).toContain("line 0 of the document");
    expect(texts(card).every((text) => text.length <= 3000)).toBe(true);
    expect(texts(card).length).toBeGreaterThan(3);
    expect(card.blocks!.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_confirm");
  });
  it("shows nested values in full instead of summarising them", () => {
    const nested = { steps: [{ name: "build", env: { A: "1", B: "2" }, run: "x".repeat(300) }, { name: "deploy", target: "prd" }], flags: { force: true } };
    const shown = describeArgs({ plan: nested, note: "hi" });
    expect(shown).toContain("\"target\": \"prd\"");
    expect(shown).toContain("x".repeat(300));
    expect(shown).toContain("\"force\": true");
    expect(shown).toContain("note: hi");
    expect(argsPreview({ plan: nested, note: "hi" }).fits).toBe(true);
  });
  it("keeps short values together and splits a huge single value without losing a character", () => {
    expect(argsPreview({ a: "1", b: "2", c: "3" })).toEqual({ chunks: ["a: 1\nb: 2\nc: 3"], fits: true });
    const value = Array.from({ length: 800 }, (_, i) => `row ${i}`).join("\n");
    const { chunks, fits } = argsPreview({ rows: value });
    expect(fits).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 2900)).toBe(true);
    expect(chunks.join("\n")).toBe(`rows: ${value}`);
    const emoji = argsPreview({ text: "😀".repeat(3000) });
    expect(emoji.chunks.join("")).toBe(`text: ${"😀".repeat(3000)}`);
  });
  it("says it doesn't fit when the details exceed what one message can carry", () => {
    expect(argsPreview({ content: "x".repeat(12_001) }).fits).toBe(false);
    expect(argsPreview(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "y".repeat(2000)]))).fits).toBe(false);
    expect(argsPreview({ content: "x".repeat(11_000) }).fits).toBe(true);
  });
  it("offers Open in DevHub, not Confirm, for details that are too large", () => {
    const card = formatTooLargeCard({ tool: t({ name: "docs_write" }), channel: "C", profile: "work" });
    expect(card.text).toContain("Too large to approve from Slack — open in DevHub");
    expect(JSON.stringify(card.blocks)).toContain("devhub_open");
    expect(JSON.stringify(card.blocks)).not.toContain("devhub_tool_confirm");
  });
  it("uses the red button when told the call is destructive, whatever the tool's own flag", () => {
    const card = formatConfirmCard({ tool: t({ destructive: false }), args: {}, id: "i", channel: "C", profile: "work", destructive: true });
    expect(card.blocks?.find((block) => block.type === "actions")).toMatchObject({ elements: [{ style: "danger", text: { text: "Yes, run it" } }, {}] });
    expect(card.text).toContain("This can't be undone.");
  });
  it("labels pick buttons as picks and run buttons as choices", () => {
    const card = formatChoiceCard({ title: "Which task?", hint: "2 tasks match.", choices: [{ label: "A", id: "1", pick: true }, { label: "B", id: "2", pick: true }], channel: "C" });
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_pick_2");
  });
});
