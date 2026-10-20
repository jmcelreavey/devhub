import { describe, expect, it } from "vitest";
import { toSlackTool } from "./mcp-catalog";
import { toolOptions, toolSubcalls } from "./tool-options";
import { buildCapabilitiesPage, parseCapabilityPage } from "./capabilities-format";
import { capabilityGroups, keywordCapabilityGroup } from "./capabilities-groups";

const tool = toSlackTool({
  name: "task_note_ops", description: "Operate on task notes. " + "Details ".repeat(80),
  inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["read", "append"] },
    request: { $ref: "#/$defs/Request" },
  }, $defs: { Request: { type: "object", properties: { op: { anyOf: [{ const: "list" }, { const: "delete" }] }, kind: { enum: ["note", "task"] }, child: { $ref: "#/$defs/Request" } } } } },
})!;

describe("Slack sub-call discovery", () => {
  it("accepts the full MCP tool-name length", () => {
    expect(toSlackTool({ name: "x".repeat(128) })?.name).toHaveLength(128);
    expect(toSlackTool({ name: "x".repeat(129) })).toBeNull();
  });
  it("finds nested enum/const discriminators, resolves local refs and terminates recursive schemas", () => {
    const calls = toolSubcalls(tool);
    expect(calls.map((call) => call.label)).toEqual(['action="read"', 'action="append"', 'request.op="list"', 'request.op="delete"', 'request.kind="note"', 'request.kind="task"']);
    expect(calls[3].args).toEqual({ request: { op: "delete" } });
  });
  it("keeps every sub-call in its own Jev option, even after a long description, and caches stable catalogs", () => {
    const catalog = [tool];
    const options = toolOptions(catalog);
    expect(options).toHaveLength(7);
    expect(options[4]).toMatchObject({ description: expect.stringContaining('request.op="delete"'), tool: { presetArgs: { request: { op: "delete" } } } });
    expect(toolOptions(catalog)).toBe(options);
    expect(toolOptions([...catalog])).not.toBe(options);
  });
  it("paginates all enum values instead of truncating them in capability cards", () => {
    const many = { ...tool, inputSchema: { properties: { action: { enum: Array.from({ length: 70 }, (_, i) => "action-" + i) } } } };
    let page = 0;
    let rendered = "";
    do {
      const card = buildCapabilitiesPage({ channel: "C", deviceLabel: "Test", tools: [many] }, { view: "tools", page });
      expect(card.blocks!.length).toBeLessThanOrEqual(50);
      rendered += JSON.stringify(card.blocks);
      const more = card.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []).find((item) => item.type === "button");
      const next = more?.type === "button" ? parseCapabilityPage(more.value) : undefined;
      if (!next) break;
      page = next.page;
    } while (page < 10);
    for (let index = 0; index < 70; index++) expect(rendered).toContain("action-" + index);
    expect(page).toBe(3);
  });
  it("groups sibling task and storyboard tools and only narrows on one whole keyword group", () => {
    const tools = ["tasks_list", "task_note_ops", "tasks_agent_plan", "storyboard_list", "notes_list"].map((name) => toSlackTool({ name })!);
    const groups = capabilityGroups(tools);
    expect(groups.find((group) => group.label === "Tasks")?.tools).toHaveLength(3);
    expect(keywordCapabilityGroup(groups, "explain my task history")?.label).toBe("Tasks");
    expect(keywordCapabilityGroup(groups, "compare tasks and notes")).toBeUndefined();
    expect(keywordCapabilityGroup(groups, "the thing")).toBeUndefined();
  });
});
