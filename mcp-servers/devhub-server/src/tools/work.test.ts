import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { DashboardClient, DashboardHttpError, type DashboardToolResult } from "../dashboard-client.ts";
import { formatJiraTicket, registerWorkTools } from "./work.ts";

function setupCreate() {
  let create: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Tool not registered"); };
  const dashboard = new DashboardClient("http://localhost:1337");
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({
    key: "PTF-9999", url: "https://jira.example/browse/PTF-9999",
  });
  const server = {
    registerTool(name: string, config: { inputSchema?: z.ZodRawShape }, handler: (input: unknown) => Promise<DashboardToolResult>) {
      if (name === "jira_ticket_create") {
        const schema = z.object(config.inputSchema!);
        create = async input => handler(schema.parse(input));
      }
    },
  };
  registerWorkTools(server as unknown as McpServer, { dashboard } as Context);
  return { create, post };
}

const issue = { projectKey: "PTF", summary: "Fix article loading", description: "Load the article while checking access." };

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
    const input = { ...issue, parentKey: "PTF-5091", assignToMe: false, sprintId: 123 };
    const result = await create({ ...input, confirm: true });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/jira/issue", input, 60_000);
    expect(result).toMatchObject({ structuredContent: { key: "PTF-9999", url: "https://jira.example/browse/PTF-9999" } });
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

describe("formatJiraTicket", () => {
  it("formats the status object returned by the Jira ticket endpoint", () => {
    expect(
      formatJiraTicket({
        key: "PTF-3896",
        status: { name: "Discovery" },
        issuetype: "Epic",
        summary: "Job Search Agent Discovery",
      }),
    ).toBe("PTF-3896 [Discovery] (Epic)\nJob Search Agent Discovery");
  });
});
