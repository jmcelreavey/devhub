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
const proposal = z.discriminatedUnion("action", [
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
    description: "List configured alert destinations and recent deliveries for the active work profile. Includes event kinds (pr-reviewed and pr-ready), the per-destination includePrDetails opt-in, consent revisions and credential variable names, never secret values. PR details and the owner mention require fresh consent in DevHub Integrations. Cannot enable or change consent.",
  }, async () => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations/alerts")) }],
  })));
  server.registerTool("integrations_alert_test", {
    description: "Send one fixed test message to an already enabled Slack or Telegram destination. Requires its current consent revision and a UUID requestId; reuse that requestId after uncertain transport to avoid duplicate sends. Does not enable alerts or approve writes. Check the channel if delivery is unknown; no automatic retry.",
    inputSchema: { id: z.string().uuid(), revision: z.number().int().positive(), requestId: z.string().uuid() },
  }, async ({ id, revision, requestId }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/alerts", { action: "test", id, revision, requestId }, 30_000)) }],
  })));
  server.registerTool("integrations_chat_status", {
    description: "Read Slack and Telegram chat-command status, active-profile allowlist counts, webhook paths and required variable names. No secrets or message content. Cannot enable commands, change allowlists or confirm provider writes.",
  }, async () => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations/chat/config")) }],
  })));
  server.registerTool("integrations_proposals", {
    description: "List recent integration proposals and their outcomes for the active work profile. Pending proposals have not been sent. Unknown outcomes must be checked at the provider before retrying.",
  }, async () => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/integrations/writes")) }],
  })));
  server.registerTool("integrations_propose", {
    description: "Request a Jira ticket/transition or GitHub PR create/update/publish proposal. Does not write to the provider. Review with integrations_review, then confirm with integrations_confirm once the user has said in chat to go ahead (or they click Confirm in DevHub Integrations).",
    inputSchema: { input: proposal },
  }, async ({ input }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/writes", { action: "propose", input }, 60_000)) }],
  })));
  server.registerTool("integrations_confirm", {
    description: "Execute a reviewed proposal. Use it when the user has told you in chat to go ahead: pass the digest from integrations_review and their own words approving it, which are kept in the audit trail. Never use it without an explicit instruction for this action. The digest must still match the live destination and content, so changed items need another review.",
    inputSchema: { id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), approvedBy: z.string().trim().min(1).max(500).describe("The user's words approving this exact action, quoted or closely paraphrased") },
  }, async ({ id, digest, approvedBy }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/writes", { action: "confirm", id, digest, confirmed: true, via: "chat", quote: approvedBy }, 60_000)) }],
  })));
  server.registerTool("integrations_review", {
    description: "Prepare the provider identity, destination and exact content for a requested proposal. Does not execute it. Confirm within 15 minutes, either with integrations_confirm when the user has approved it in chat, or in DevHub; stale previews need another review. No automatic retry of an unknown outcome.",
    inputSchema: { id: z.string().uuid() },
  }, async ({ id }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/integrations/writes", { action: "review", id }, 60_000)) }],
  })));
}
