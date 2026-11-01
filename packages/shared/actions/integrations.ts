import { z } from "zod";
import { defineAction } from "./define.ts";

export const integrationRefInput = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  account: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  kind: z.enum(["issue", "repo", "pr", "check", "doc", "chat"]),
  id: z.string().trim().min(1).max(500),
}).strict();

const account = integrationRefInput.shape.account;
const provider = integrationRefInput.shape.provider;
const title = z.string().trim().min(1).max(255);
const body = z.string().max(20000);
const repo = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
// eslint-disable-next-line no-control-regex -- git refnames forbid control characters
const branch = z.string().trim().min(1).max(255).refine((value) => !/[\x00-\x20~^:?*[\\]/.test(value) && !value.includes("..") && !value.startsWith("-"), "Use a valid branch name.");
const assignSelf = z.object({ action: z.literal("issue.assign-self"), provider, account, ref: integrationRefInput }).strict();
const assign = z.object({ action: z.literal("issue.assign"), provider, account, ref: integrationRefInput, assignee: z.string().trim().min(1).max(200) }).strict();
const issueCreate = z.object({ action: z.literal("issue.create"), provider, account, projectKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/), title, body: body.min(1).max(5000), parentKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).nullable().default(null), taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(), assignToMe: z.boolean().default(true), sprintId: z.number().int().positive().nullable().default(null) }).strict();
const issueTransition = z.object({ action: z.literal("issue.transition"), provider, account, ref: integrationRefInput, transitionId: z.string().regex(/^[0-9]+$/) }).strict();
const prCreate = z.object({ action: z.literal("pr.create"), provider, account, repo, head: branch, base: branch, title, body, draft: z.boolean().default(false) }).strict();
const prUpdate = z.object({ action: z.literal("pr.update"), provider, account, ref: integrationRefInput, title, body }).strict();
const prPublish = z.object({ action: z.literal("pr.publish"), provider, account, ref: integrationRefInput }).strict();

const writeUnion = z.discriminatedUnion("action", [assignSelf, assign, issueCreate, issueTransition, prCreate, prUpdate, prPublish]);
type WriteValue = z.input<typeof writeUnion>;
function validateWrite(input: WriteValue, context: z.RefinementCtx): void {
  const nativeProvider = input.provider === "jira" || input.provider === "github";
  const issueAction = input.action.startsWith("issue.");
  if (nativeProvider && (input.provider === "jira") !== issueAction) context.addIssue({ code: "custom", message: "Choose an action supported by the selected native provider." });
  if (nativeProvider && "ref" in input && !(input.provider === "jira" ? /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/ : /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[1-9][0-9]*$/).test(input.ref.id)) {
    context.addIssue({ code: "custom", message: "Use a native Jira key or owner/repository/number for the PR." });
  }
  if (input.provider === "github" && ("repo" in input ? input.repo : "ref" in input ? input.ref.id : "").split("/").some((part) => part === "." || part === "..")) {
    context.addIssue({ code: "custom", message: "Use a valid GitHub repository." });
  }
  if ("ref" in input && (input.ref.provider !== input.provider || input.ref.account !== input.account || input.ref.kind !== (issueAction ? "issue" : "pr"))) {
    context.addIssue({ code: "custom", message: "The item must belong to the selected provider, account and kind." });
  }
}

export const integrationWriteInput = writeUnion.superRefine(validateWrite);
const nativeRef = integrationRefInput.extend({ provider: z.enum(["jira", "github"]), kind: z.enum(["issue", "pr"]) });
const nativeWriteInput = z.discriminatedUnion("action", [
  issueCreate.extend({ provider: z.literal("jira"), parentKey: issueCreate.shape.parentKey.unwrap().optional(), assignToMe: issueCreate.shape.assignToMe.unwrap().optional(), sprintId: issueCreate.shape.sprintId.unwrap().optional() }),
  issueTransition.extend({ provider: z.literal("jira"), ref: nativeRef }),
  prCreate.extend({ provider: z.literal("github"), draft: prCreate.shape.draft.unwrap().optional() }),
  prUpdate.extend({ provider: z.literal("github"), ref: nativeRef }),
  prPublish.extend({ provider: z.literal("github"), ref: nativeRef }),
]).superRefine(validateWrite);

export const integrationsListInput = z.object({ taskId: z.string().min(1).max(100).optional() }).meta({ additionalProperties: false });
export const integrationsWriteInput = z.object({ input: nativeWriteInput }).meta({ additionalProperties: false });
export const integrationProviderWriteInput = z.object({ input: integrationWriteInput }).meta({ additionalProperties: false });
export interface IntegrationsListContext { list: (taskId?: string) => Promise<unknown> }
export interface IntegrationsWriteContext { write: (input: z.input<typeof integrationWriteInput>) => Promise<unknown> }

export const integrationsList = defineAction<typeof integrationsListInput, IntegrationsListContext, unknown>({
  input: integrationsListInput,
  http: { method: "GET", path: "/api/integrations" },
  mcp: { name: "integrations_list", toolset: "integrations", description: "List integration providers, capabilities and account references, optionally with a task\u0027s linked items. Never returns credential values. Requires the dashboard." },
  handler: ({ taskId }, context) => context.list(taskId),
});
export const integrationsWrite = defineAction<typeof integrationsWriteInput, IntegrationsWriteContext, unknown>({
  input: integrationsWriteInput,
  http: { method: "POST", path: "/api/integrations/actions", discriminator: "body matches native write input" },
  mcp: { name: "integrations_write", toolset: "integrations", description: "Write to Jira or GitHub immediately: create or transition a Jira ticket, or create, update or publish a GitHub PR. Only call this tool when the user asked for that specific change. Check the provider before retrying an uncertain outcome." },
  handler: ({ input }, context) => context.write(input),
});
export const integrationProviderWrite = defineAction<typeof integrationProviderWriteInput, IntegrationsWriteContext, unknown>({
  input: integrationProviderWriteInput,
  http: { method: "POST", path: "/api/integrations/actions", discriminator: "body does not match native write input" },
  mcp: { reason: "Plugin-provider and assignment operations remain owned by their existing provider-specific tools." },
  handler: ({ input }, context) => context.write(input),
});
