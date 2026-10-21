import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const account = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const title = z.string().trim().min(1).max(255);
const body = z.string().max(20000);
const ref = z.object({
  provider: z.enum(["jira", "github"]), account,
  kind: z.enum(["issue", "pr"]), id: z.string().trim().min(1).max(500),
}).strict();
const branch = z.string().trim().min(1).max(255).refine((value) => !/[\x00-\x20~^:?*\[\\]/.test(value) && !value.includes("..") && !value.startsWith("-"), "Use a valid branch name.");
const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue.create"), provider: z.literal("jira"), account, projectKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/), title, body: body.min(1).max(5000), parentKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).nullable().optional(), taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(), assignToMe: z.boolean().optional(), sprintId: z.number().int().positive().nullable().optional() }).strict(),
  z.object({ action: z.literal("issue.transition"), provider: z.literal("jira"), account, ref, transitionId: z.string().regex(/^[0-9]+$/) }).strict(),
  z.object({ action: z.literal("pr.create"), provider: z.literal("github"), account, repo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/), head: branch, base: branch, title, body, draft: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("pr.update"), provider: z.literal("github"), account, ref, title, body }).strict(),
  z.object({ action: z.literal("pr.publish"), provider: z.literal("github"), account, ref }).strict(),
]).superRefine((input, context) => {
  if ("ref" in input && (input.ref.provider !== input.provider || input.ref.account !== input.account || input.ref.kind !== (input.provider === "jira" ? "issue" : "pr"))) {
    context.addIssue({ code: "custom", message: "The item must belong to the selected provider, account and kind." });
  }
  if ("ref" in input && !(input.provider === "jira" ? /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/ : /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[1-9][0-9]*$/).test(input.ref.id)) {
    context.addIssue({ code: "custom", message: "Use a native Jira key or owner/repository/number for the PR." });
  }
  if (input.provider === "github" && ("repo" in input ? input.repo : input.ref.id).split("/").some((part) => part === "." || part === "..")) {
    context.addIssue({ code: "custom", message: "Use a valid GitHub repository." });
  }
});

export function registerIntegrationTools(server: McpServer, ctx: Context): void {
  server.registerTool("integrations_slack_status", {
    description: "Read Slack Socket Mode connection status, masked settings, settings revision and active task profile. Never returns tokens or starts a connection. Configure Slack in DevHub Setup.",
  }, async () => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations/slack/status")) }],
  })));
  server.registerTool("integrations_slack_usage", {
    description: "Read today's Slack bot usage: questions answered, how many were free keyword rules, Jev routing calls with their estimated cost, and cheap-model calls. Read-only; never returns message text, tokens or Slack content.",
  }, async () => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations/slack/usage")) }],
  })));
  server.registerTool("integrations_slack_test", {
    description: "Send one short test to the Slack bot's saved channel. Read integrations_slack_status for the current settings revision. Requires a UUID requestId; reuse it after uncertain transport to avoid duplicate sends. Does not change settings, enable alerts or run task actions. Check the channel if delivery is unknown; no automatic retry.",
    inputSchema: { revision: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() },
  }, async ({ revision, requestId }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/slack/test", { revision, requestId }, 30_000)) }],
  })));
  server.registerTool("integrations_list", {
    description: "List integration providers, capabilities and account references, optionally with a task's linked items. Never returns credential values. Requires the dashboard.",
    inputSchema: { taskId: z.string().min(1).max(100).optional() },
  }, async ({ taskId }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations", taskId ? { taskId } : undefined)) }],
  })));
  server.registerTool("integrations_alert_destinations", {
    description: "Legacy alerts were removed. Configure the separate Slack bot in Setup.",
  }, async () => ({ content: [{ type: "text", text: "Telegram support was removed. Legacy alert destinations are no longer available. Configure Slack in Setup." }] }));
  server.registerTool("integrations_alert_test", {
    description: "Legacy alert tests were removed. Use integrations_slack_test for the separate Slack bot.",
    inputSchema: { id: z.string().uuid(), revision: z.number().int().positive(), requestId: z.string().uuid() },
  }, async () => ({ content: [{ type: "text", text: "Telegram support was removed. Use integrations_slack_test to test the Slack bot." }] }));
  server.registerTool("integrations_chat_status", {
    description: "Legacy chat commands were removed. Use integrations_slack_status for the separate Slack bot.",
  }, async () => ({ content: [{ type: "text", text: "Telegram support was removed. Use integrations_slack_status for Slack." }] }));
  server.registerTool("integrations_proposals", {
    description: "The proposal queue was removed. Write tools apply actions immediately.",
  }, async () => ({ content: [{ type: "text", text: "The proposal queue was removed. Write tools apply actions immediately." }] }));
  server.registerTool("integrations_propose", {
    description: "Apply a Jira ticket/transition or GitHub PR create/update/publish immediately. The legacy tool name is retained; no proposal or human approval is required. Check the provider before retrying an uncertain outcome.",
    inputSchema: { input: actionInput },
  }, async ({ input }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/actions", input, 60_000)) }],
  })));
  server.registerTool("integrations_confirm", {
    description: "Approval was removed. Actions apply immediately when the write tool is called; this compatibility tool does not repeat them.",
    inputSchema: { id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), approvedBy: z.string().trim().min(1).max(500).describe("The user's words approving this exact action, quoted or closely paraphrased") },
  }, async () => ({ content: [{ type: "text", text: "MCP approval was removed. Actions apply immediately; nothing needs confirmation. This call did not repeat an action." }] }));
  server.registerTool("integrations_review", {
    description: "Proposal review was removed. Actions apply immediately when the write tool is called.",
    inputSchema: { id: z.string().uuid() },
  }, async () => ({ content: [{ type: "text", text: "MCP approval was removed. There is no proposal to review." }] }));
}
