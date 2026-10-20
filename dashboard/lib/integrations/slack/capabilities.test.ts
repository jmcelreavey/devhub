import { describe, expect, it } from "vitest";
import type { SlackMessage } from "./client";
import type { SlackTool } from "./mcp-catalog";
import { toSlackTool } from "./mcp-catalog";
import { capabilityGroups, matchingCapabilityGroups } from "./capabilities-groups";
import { buildCapabilitiesOverview, buildCapabilitiesPage, capabilityPageValue, parseCapabilityPage, toolDescription, toolRiskLabel, type CapabilityPageState } from "./capabilities-format";
import { routeSlackMessage } from "./router";
import { directToolRule } from "./tool-args";
import { commandRule } from "./ticket-args";

const context = { activeProfile: "work", profiles: ["work", "personal"] };
const input = { channel: "C1", threadTs: "1.1", deviceLabel: "John’s MacBook", profile: "work" };
function tool(name: string, category: string, extra: Partial<SlackTool> = {}): SlackTool {
  return { name, category, description: "Read the current list. More detail follows.", readOnly: true, destructive: false, inputSchema: {}, ...extra };
}
function checkLimits(message: SlackMessage) {
  expect(message.text.length).toBeLessThanOrEqual(4000);
  expect(message.blocks!.length).toBeLessThanOrEqual(50);
  for (const block of message.blocks!) {
    if (block.type === "header") expect(block.text.text.length).toBeLessThanOrEqual(150);
    if (block.type === "section" && block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
    if (block.type === "actions") {
      expect(block.elements.length).toBeLessThanOrEqual(25);
      expect(new Set(block.elements.map((element) => element.action_id)).size).toBe(block.elements.length);
      for (const element of block.elements) if (element.type === "button") {
        expect(element.value!.length).toBeLessThanOrEqual(2000);
        expect(element.text.text.length).toBeLessThanOrEqual(75);
        expect(parseCapabilityPage(element.value)).toBeDefined();
      }
    }
  }
}

describe("free capability routing", () => {
  it.each(["help", "commands", "what can you do", "what can you do?", "WHAT ELSE CAN YOU DO?!", "what can DevHub do", "capabilities", "hi", "hello", "HELP."])("routes the overview: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "help", profile: "work" });
  });
  it.each(["tools", "all tools", "list tools", "list all tools", "show tools", "what tools", "TOOLS?!"])("routes tool lists: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "tools", profile: "work" });
  });
  it("scopes groups without capturing ticket questions or existing commands", () => {
    expect(routeSlackMessage("tools Plugin: company in personal?", context)).toEqual({ kind: "tools", group: "plugin company", profile: "personal" });
    for (const text of ["what task tools", "task tools", "tools for tasks", "show me jira tools?"]) expect(routeSlackMessage(text, context)).toMatchObject({ kind: "tools", group: expect.any(String) });
    expect(routeSlackMessage("tools are broken on PTF-1", context)).toMatchObject({ kind: "task", jiraKey: "PTF-1" });
    expect(routeSlackMessage("tools are broken", context).kind).toBe("unknown");
    expect(routeSlackMessage("my tickets", context).kind).toBe("unknown");
    expect(directToolRule("my tickets")).toMatchObject({ tool: "jira_tickets" });
    for (const phrase of ["needs me", "my PRs", "plan PTF-1", "meetings today", "add task Review the offline cache", "worktrees"]) {
      expect(routeSlackMessage(phrase, context).kind !== "unknown" || !!directToolRule(phrase) || !!commandRule(phrase)).toBe(true);
    }
  });
});

describe("capability groups and cards", () => {
  const tools = [tool("tasks_list", "tasks"), tool("jira_tickets", "work"), tool("task_handoff", "tasks"), tool("company_query", "plugin:company", { plugin: "company" }), tool("music_list", "music-library"), tool("external_search", "search", { server: "external" })];
  it("keeps core, each installed plugin, unknown categories and other servers", () => {
    const groups = capabilityGroups(tools);
    expect(groups.map((group) => group.label)).toEqual(["Tasks", "Jira", "Team", "Music library", "Plugin: company", "MCP: external"]);
    expect(groups.flatMap((group) => group.tools)).toHaveLength(tools.length);
    for (const query of ["COMPANY", "plugin company", "plugin:company"]) expect(matchingCapabilityGroups(groups, query).map((group) => group.label)).toEqual(["Plugin: company"]);
    expect(matchingCapabilityGroups(groups, "music")[0].label).toBe("Music library");
    expect(matchingCapabilityGroups(groups, "external")[0].label).toBe("MCP: external");
    expect(toSlackTool({ name: "external_read", _meta: { "devhub/server": "external" } })?.server).toBe("external");
  });
  it.each([
    [tool("notes_list", "notes"), "read-only"],
    [tool("notes_write", "notes", { readOnly: false }), "asks Confirm"],
    [tool("notes_delete", "notes", { readOnly: false, destructive: true }), "destructive · asks Confirm"],
    [tool("plugin_unknown", "plugin", { unrated: true, readOnly: false }), "asks Confirm"],
    [tool("agent_dispatch", "agents"), "destructive · asks Confirm"],
    [tool("datadog_investigate", "datadog"), "asks Confirm"],
    [tool("repos_git_branch", "repos"), "destructive · asks Confirm"],
  ])("uses Slack risk overrides for %s", (entry, label) => expect(toolRiskLabel(entry)).toBe(label));
  it("sentence-clips descriptions, uses ellipses for long sentences and escapes tool text", () => {
    expect(toolDescription("Read a list. Then change it.")).toBe("Read a list.");
    expect(toolDescription("Switch the profile (e.g. dev, i.e. sandbox). Then reload.")).toBe("Switch the profile (e.g. dev, i.e. sandbox).");
    const long = toolDescription("A useful description ".repeat(20));
    expect(long.length).toBeLessThanOrEqual(140); expect(long).toMatch(/description…$|useful…$|A…$/);
    const page = buildCapabilitiesPage({ ...input, tools: [tool("notes_list", "notes", { description: "<@U1> & <!channel>." })] }, { view: "tools", page: 0 });
    expect(JSON.stringify(page.blocks)).not.toContain("<@U1>");
    expect(JSON.stringify(page.blocks)).toContain("&lt;@U1&gt;");
  });
  it("offers all tools and each group, with a device footer and useful fallback", () => {
    const message = buildCapabilitiesOverview({ ...input, tools });
    checkLimits(message);
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []);
    expect(buttons).toHaveLength(1 + capabilityGroups(tools).length);
    expect(message.text).toContain("From John’s MacBook · 6 tools");
    expect(message.text).toContain("Plugin: company");
    expect(JSON.stringify(message)).toContain("in work");
  });
  it("still shows static guidance when the local catalog is unavailable", () => {
    const message = buildCapabilitiesOverview(input); checkLimits(message);
    expect(message.text).toContain("couldn't be read"); expect(message.text).toContain("refresh tools");
    expect(JSON.stringify(message.blocks)).toContain("Reply in a task thread");
    expect(JSON.stringify(message.blocks)).toContain("Reads run straight away");
  });
  it("paginates 300 tools with long descriptions, visiting each exactly once", () => {
    const catalog = Array.from({ length: 300 }, (_, index) => tool("tool_" + index.toString().padStart(3, "0"), "category-" + index, { description: "<@U1> & long descriptions need room on mobile ".repeat(100), ...(index % 5 === 0 ? { plugin: "company" } : {}) }));
    checkLimits(buildCapabilitiesOverview({ ...input, tools: catalog }));
    const names: string[] = [];
    let state: CapabilityPageState | undefined = { view: "tools", page: 0 };
    let count = 0;
    while (state) {
      const page = buildCapabilitiesPage({ ...input, tools: catalog }, state); checkLimits(page);
      expect(page.thread_ts).toBe(input.threadTs);
      for (const block of page.blocks!) if (block.type === "section" && block.text) names.push(...[...block.text.text.matchAll(/\x60(tool_\d+)\x60/g)].map((match) => match[1]));
      const more = page.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []).find((element) => element.type === "button");
      state = more?.type === "button" ? parseCapabilityPage(more.value) : undefined;
      if (state) expect(state.page).toBe(++count);
    }
    expect(names).toHaveLength(300); expect(new Set(names).size).toBe(300);
    expect(names.sort()).toEqual(catalog.map((entry) => entry.name).sort());
  });
  it("filters pages and rejects stale pages", () => {
    const page = buildCapabilitiesPage({ ...input, tools }, { view: "tools", group: "company", page: 0 });
    expect(JSON.stringify(page.blocks)).toContain("company_query"); expect(JSON.stringify(page.blocks)).not.toContain("tasks_list");
    expect(buildCapabilitiesPage({ ...input, tools }, { view: "tools", page: 99 }).text).toContain("no longer available");
    expect(buildCapabilitiesPage({ ...input, tools }, { view: "tools", group: "not-installed", page: 0 }).blocks).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.objectContaining({ text: expect.stringContaining("No matching tools") }) })]));
  });
  it.each([undefined, "{}", "not json", "null", "[]", '{"v":2,"view":"tools","page":0}', '{"v":1,"view":"tools","page":-1}', '{"v":1,"view":"tools","page":1.2}', '{"v":1,"view":"tools","page":0,"group":{}}', '{"v":1,"view":"tools","page":0,"profile":"../work"}', "x".repeat(2001)])("rejects invalid page values: %s", (value) => expect(parseCapabilityPage(value)).toBeUndefined());
  it("round-trips page state", () => {
    const state = { view: "tools" as const, group: "Plugin: company", page: 2, profile: "work" };
    expect(parseCapabilityPage(capabilityPageValue(state))).toEqual(state);
  });
});
