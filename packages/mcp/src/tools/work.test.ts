import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { jiraTicketAssignInput, jiraTicketCreateInput, jiraTicketTransitionInput, prAutoReview, prAutoReviewSettingsSet, prPipelineInvestigate } from "../../../../packages/shared/actions/work.ts";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { DashboardClient, DashboardHttpError, type DashboardToolResult } from "../dashboard-client.ts";
import { formatJiraTicket, registerWorkTools } from "./work.ts";

describe("prs_list compatibility", () => {
  it("adds structured rows for Slack without changing the existing text or input schema", async () => {
    const authored = [{ repo: "team/service", number: 12, title: "Fix feed", url: "https://github.com/team/service/pull/12", checks: "passing", checkCounts: { passed: 3, failed: 0, pending: 0 }, approved: true, draft: true }];
    const dashboard = new DashboardClient("http://localhost:1337");
    vi.spyOn(dashboard, "get").mockResolvedValue({ configured: true, authored, reviews: [] });
    let run: (() => Promise<unknown>) | undefined;
    let configuration: unknown;
    const server = {
      registerTool(name: string, config: unknown, handler: () => Promise<unknown>) {
        if (name === "prs_list") { run = handler; configuration = config; }
      },
    };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    const result = await run!() as { content: Array<{ type: string; text?: string }>; structuredContent?: unknown };
    expect(result.content.filter((part) => part.type === "text")).toEqual([{ type: "text", text: "Authored (1):\n  - team/service#12 [passing: 3✓ 0✗ 0…] ✓approved Fix feed\n    https://github.com/team/service/pull/12\n\nAwaiting my review (0):\n  (none)" }]);
    expect(result.structuredContent).toEqual({ authored, reviews: [] });
    expect(configuration).not.toHaveProperty("inputSchema");
    expect(configuration).not.toHaveProperty("outputSchema");
    expect(dashboard.get).toHaveBeenCalledExactlyOnceWith("/api/github/prs");
  });
});

describe("Jira read actions", () => {
  it("keeps the no-input ticket list and formats ticket details", async () => {
    const dashboard = new DashboardClient("http://localhost:1447");
    const get = vi.spyOn(dashboard, "get")
      .mockResolvedValueOnce({ configured: true, tickets: [{ key: "ABC-1", status: "Open", summary: "Example" }] })
      .mockResolvedValueOnce({ key: "ABC-1", status: "Open", summary: "Example", assignee: null });
    const tools = new Map<string, { config: unknown; run: (input?: unknown) => Promise<DashboardToolResult> }>();
    const server = {
      registerTool(name: string, config: unknown, run: (input?: unknown) => Promise<DashboardToolResult>) {
        tools.set(name, { config, run });
      },
    };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    const list = tools.get("jira_tickets")!;
    expect(list.config).not.toHaveProperty("inputSchema");
    expect((await list.run()).content[0]).toMatchObject({ text: "My Jira tickets:\n- ABC-1 [Open] Example" });
    expect((await tools.get("jira_ticket_get")!.run({ key: "ABC-1" })).content[0]).toMatchObject({ text: "ABC-1 [Open]\nExample\nAssignee: Unassigned" });
    expect(get).toHaveBeenNthCalledWith(1, "/api/jira/tickets");
    expect(get).toHaveBeenNthCalledWith(2, "/api/jira/ticket/ABC-1");
  });
});

describe("work summaries", () => {
  it("keeps standup and weekly dashboard calls and formatted output", async () => {
    const dashboard = new DashboardClient("http://localhost:1447");
    const get = vi.spyOn(dashboard, "get")
      .mockResolvedValueOnce({ markdown: "  Yesterday's work  " })
      .mockResolvedValueOnce({ start: "2026-10-23", end: "2026-10-29", totals: { completed: 1 }, days: [], slipped: [] });
    const tools = new Map<string, (input: unknown) => Promise<DashboardToolResult>>();
    const server = { registerTool(name: string, _config: unknown, run: (input: unknown) => Promise<DashboardToolResult>) { tools.set(name, run); } };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    expect((await tools.get("standup_markdown")!({ startDate: "2026-10-28" })).content[0]).toMatchObject({ text: "Yesterday's work" });
    expect((await tools.get("tasks_weekly")!({ end: "2026-10-29" })).content[0]).toMatchObject({ text: expect.stringContaining("Week 2026-10-23 → 2026-10-29: 1 done") });
    expect(get).toHaveBeenNthCalledWith(1, "/api/standup/markdown", { startDate: "2026-10-28", endDate: undefined }, 60_000);
    expect(get).toHaveBeenNthCalledWith(2, "/api/tasks/weekly", { end: "2026-10-29" });
  });
});

describe("prs_open_in_cursor confirmation", () => {
  function setupOpen() {
    let run: (input: { repo: string; number: number; notePath?: string; confirm?: boolean }) => Promise<DashboardToolResult> = async () => { throw new Error("Tool not registered"); };
    const dashboard = new DashboardClient("http://localhost:1337");
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ branch: "feature", stashed: true });
    const server = {
      registerTool(name: string, _config: unknown, handler: typeof run) {
        if (name === "prs_open_in_cursor") run = handler;
      },
    };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    return { run, post };
  }

  it.each([undefined, false])("does not stash or check out without confirmation (%s)", async confirm => {
    const { run, post } = setupOpen();
    const result = await run({ repo: "team/service", number: 12, confirm });
    expect(result.isError).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("checks out exactly once when confirmed", async () => {
    const { run, post } = setupOpen();
    const result = await run({ repo: "team/service", number: 12, notePath: "pr-reviews/service-12", confirm: true });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/github/prs/open-in-cursor", { repo: "team/service", number: 12, notePath: "pr-reviews/service-12" }, 120_000);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("stashed local changes") });
  });
});

describe("pipeline investigation confirmation", () => {
  it.each([
    [{ rerunFailed: true }, false],
    [{ confirm: false, rerunFailed: true }, false],
    [{ confirm: true, dryRun: true, rerunFailed: true }, false],
    [{ confirm: true, rerunFailed: true }, true],
  ])("gates agent start and reruns for %j", async (options, mayStart) => {
    const investigate = vi.fn().mockResolvedValue({ status: 200, body: {} });
    await prPipelineInvestigate.handler({ repo: "team/service", number: 12, ...options }, { investigate });
    expect(investigate).toHaveBeenCalledOnce();
    expect(investigate.mock.calls[0][1]).toBe(mayStart);
  });
});

describe("auto-review confirmation", () => {
  it.each([[undefined, true], [false, true], [true, false]])("maps confirmation %s to dry-run %s", async (confirm, dryRun) => {
    const review = vi.fn().mockResolvedValue({ status: 200, body: {} });
    await prAutoReview.handler({ confirm, limit: 2 }, { review });
    expect(review).toHaveBeenCalledExactlyOnceWith({ dryRun, limit: 2 });
  });
});

describe("auto-review settings", () => {
  it("does not write an empty settings patch", async () => {
    const save = vi.fn();
    expect(await prAutoReviewSettingsSet.handler({}, { save })).toEqual({ kind: "missing" });
    expect(save).not.toHaveBeenCalled();
  });

  it("saves only provided settings", async () => {
    const save = vi.fn().mockResolvedValue({ status: 200, body: {} });
    await prAutoReviewSettingsSet.handler({ enabled: false }, { save });
    expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: false });
  });
});

function setupCreate() {
  let create: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Tool not registered"); };
  const dashboard = new DashboardClient("http://localhost:1337");
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({
    key: "ABC-9999", url: "https://jira.example/browse/ABC-9999",
  });
  const server = {
    registerTool(name: string, config: { inputSchema?: unknown }, handler: (input: unknown) => Promise<DashboardToolResult>) {
      if (name === "jira_ticket_create") {
        expect(config.inputSchema).toBe(jiraTicketCreateInput);
        create = async input => handler(jiraTicketCreateInput.parse(input));
      }
    },
  };
  registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
  return { create, post };
}

const issue = { projectKey: "ABC", summary: "Fix article loading", description: "Load the article while checking access." };

describe("jira_ticket_create", () => {
  it.each([undefined, false])("does not write without confirmation (%s)", async confirm => {
    const { create, post } = setupCreate();
    const result = await create({ ...issue, confirm });
    expect(result.isError).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("confirm: true") });
  });

  it("posts the supported fields through the dashboard and returns the key and URL", async () => {
    const { create, post } = setupCreate();
    const input = { ...issue, parentKey: "ABC-5091", assignToMe: false, sprintId: 123 };
    const result = await create({ ...input, confirm: true });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/jira/issue", input, 60_000);
    expect(result).toMatchObject({ structuredContent: { key: "ABC-9999", url: "https://jira.example/browse/ABC-9999" } });
    expect(result.isError).not.toBe(true);
  });


  it("leaves optional defaults to the dashboard", async () => {
    const { create, post } = setupCreate();
    await create({ ...issue, confirm: true });
    expect(post).toHaveBeenCalledWith("/api/jira/issue", issue, 60_000);
  });

  it.each([
    { projectKey: "bad-key" }, { summary: " " }, { summary: "a".repeat(256) },
    { description: "" }, { description: "a".repeat(5001) }, { parentKey: "invalid" },
    { sprintId: -1 }, { sprintId: 1.5 },
  ])("rejects invalid input before writing: %j", async invalid => {
    const { create, post } = setupCreate();
    await expect(create({ ...issue, ...invalid, confirm: true })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("surfaces a refused dashboard request without retrying", async () => {
    const { create, post } = setupCreate();
    post.mockRejectedValueOnce(new DashboardHttpError(403, { error: "Forbidden" }, "Forbidden"));
    const result = await create({ ...issue, confirm: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Forbidden") });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("declares creation as a non-idempotent external write", () => {
    expect(TOOL_ANNOTATIONS.jira_ticket_create).toEqual({
      readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true,
    });
  });
});

describe("jira_ticket_transition", () => {
  function setupTransition() {
    let run: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Tool not registered"); };
    const dashboard = new DashboardClient("http://localhost:1337");
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ key: "ABC-1", ok: true });
    const server = {
      registerTool(name: string, config: { inputSchema?: unknown }, handler: (input: unknown) => Promise<DashboardToolResult>) {
        if (name === "jira_ticket_transition") { expect(config.inputSchema).toBe(jiraTicketTransitionInput); run = async input => handler(jiraTicketTransitionInput.parse(input)); }
      },
    };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    return { run, post };
  }

  it("applies the transition immediately with confirm:true", async () => {
    const { run, post } = setupTransition();
    const result = await run({ key: "ABC-1", transitionId: "41", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/jira/ticket/ABC-1/transition", { transitionId: "41" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Moved ABC-1") });
  });

  it("reports a directly applied transition as moved", async () => {
    const { run, post } = setupTransition();
    post.mockResolvedValue({ key: "ABC-1", ok: true, from: "In Progress", to: "Code Review" });
    const result = await run({ key: "ABC-1", transitionId: "71", confirm: true });
    expect(result.content[0]).toMatchObject({ text: "Moved ABC-1 via transition 71 (In Progress → Code Review)." });
  });
});

describe("jira_ticket_assign", () => {
  function setupAssign() {
    let run: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Tool not registered"); };
    const dashboard = new DashboardClient("http://localhost:1337");
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ key: "ABC-1", ok: true, assignee: "Alex Example", from: null });
    const server = {
      registerTool(name: string, config: { inputSchema?: unknown }, handler: (input: unknown) => Promise<DashboardToolResult>) {
        if (name === "jira_ticket_assign") { expect(config.inputSchema).toBe(jiraTicketAssignInput); run = async input => handler(jiraTicketAssignInput.parse(input)); }
      },
    };
    registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
    return { run, post };
  }

  it("assigns to me by default with confirm:true", async () => {
    const { run, post } = setupAssign();
    const result = await run({ key: "ABC-1", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/jira/ticket/ABC-1/assign", { assignee: "me" });
    expect(result.content[0]).toMatchObject({ text: "Assigned ABC-1 to Alex Example (was unassigned)." });
  });

  it("passes a named assignee and reports who had it", async () => {
    const { run, post } = setupAssign();
    post.mockResolvedValue({ key: "ABC-1", ok: true, assignee: "Sarah", from: "Alex Example" });
    const result = await run({ key: "ABC-1", assignee: "sarah@example.com", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/jira/ticket/ABC-1/assign", { assignee: "sarah@example.com" });
    expect(result.content[0]).toMatchObject({ text: "Assigned ABC-1 to Sarah (was Alex Example)." });
  });

  it("does nothing without confirm", async () => {
    const { run, post } = setupAssign();
    const result = await run({ key: "ABC-1" });
    expect(result.isError).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("declares assignment as an idempotent external write", () => {
    expect(TOOL_ANNOTATIONS.jira_ticket_assign).toMatchObject({ readOnlyHint: false, idempotentHint: true, openWorldHint: true });
  });
});

describe("formatJiraTicket", () => {
  it("adds the assignee line when the dashboard reports one", () => {
    expect(formatJiraTicket({ key: "ABC-1", status: { name: "To Do" }, summary: "S", assignee: { accountId: "a1", displayName: "Alex" } }))
      .toBe("ABC-1 [To Do]\nS\nAssignee: Alex (a1)");
    expect(formatJiraTicket({ key: "ABC-1", status: { name: "To Do" }, summary: "S", assignee: null })).toBe("ABC-1 [To Do]\nS\nAssignee: Unassigned");
  });

  it("formats the status object returned by the Jira ticket endpoint", () => {
    expect(
      formatJiraTicket({
        key: "ABC-3896",
        status: { name: "Discovery" },
        issuetype: "Epic",
          summary: "Example Agent Discovery",
      }),
    ).toBe("ABC-3896 [Discovery] (Epic)\nExample Agent Discovery");
  });
});
