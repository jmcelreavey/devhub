import { z } from "zod";
import { RefSchema, type IntegrationItem } from "./types";

const account = RefSchema.shape.account;
const title = z.string().trim().min(1).max(255);
const body = z.string().max(20000);
const repo = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
const branch = z.string().trim().min(1).max(255).refine((s) => !/[\x00-\x20~^:?*\[\\]/.test(s) && !s.includes("..") && !s.startsWith("-"), "Use a valid branch name.");
export const WriteInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue.assign-self"), provider: z.literal("jira"), account, ref: RefSchema }).strict(),
  z.object({ action: z.literal("issue.create"), provider: z.literal("jira"), account, projectKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/), title, body: body.min(1).max(5000), parentKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).nullable().default(null), taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(), assignToMe: z.boolean().default(true), sprintId: z.number().int().positive().nullable().default(null) }).strict(),
  z.object({ action: z.literal("issue.transition"), provider: z.literal("jira"), account, ref: RefSchema, transitionId: z.string().regex(/^[0-9]+$/) }).strict(),
  z.object({ action: z.literal("pr.create"), provider: z.literal("github"), account, repo, head: branch, base: branch, title, body, draft: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("pr.update"), provider: z.literal("github"), account, ref: RefSchema, title, body }).strict(),
  z.object({ action: z.literal("pr.publish"), provider: z.literal("github"), account, ref: RefSchema }).strict(),
]).superRefine((input, ctx) => {
  if ("ref" in input && !(input.provider === "jira" ? /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/ : /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[1-9][0-9]*$/).test(input.ref.id)) {
    ctx.addIssue({ code: "custom", message: "Use a native Jira key or owner/repository/number for the PR." });
  }
  if (input.provider === "github" && ("repo" in input ? input.repo : input.ref.id).split("/").some((part) => part === "." || part === "..")) {
    ctx.addIssue({ code: "custom", message: "Use a valid GitHub repository." });
  }
  if ("ref" in input && (input.ref.provider !== input.provider || input.ref.account !== input.account || input.ref.kind !== (input.provider === "jira" ? "issue" : "pr"))) {
    ctx.addIssue({ code: "custom", message: "The item must belong to the selected provider, account and kind." });
  }
});
export type WriteInput = z.infer<typeof WriteInputSchema>;
export interface PreparedWrite {
  destination: string;
  actor: string;
  summary: string;
  details: Record<string, unknown>;
  /** Exact native request plus remote revision/branch evidence. Never credentials. */
  native: Record<string, unknown>;
}
export interface WriteContext { signal: AbortSignal; approvalId: string }
export interface WriteReceipt { item?: IntegrationItem; detail: string }
export interface WriteProposal {
  id: string;
  profile: string;
  input: WriteInput;
  source: string;
  createdAt: string;
  expiresAt: string;
  state: "requested" | "pending" | "unknown" | "succeeded" | "failed" | "cancelled";
  /** "direct" is a person's own click in DevHub; "review" is a proposal confirmed in DevHub; "chat" is one the person approved in a chat or through MCP. Absent on older records. */
  approval?: "direct" | "review" | "chat";
  /** For "chat": the words in which the person approved it. */
  approvalNote?: string;
  prepared?: PreparedWrite;
  digest?: string;
  detail?: string;
  confirmedAt?: string;
  finishedAt?: string;
  receipt?: WriteReceipt;
  taskJiraKey?: string | null;
  taskLink?: "linked" | "skipped" | "failed";
}
