import { z } from "zod";
import { defineAction } from "./define.ts";

export interface ConventionsResponse {
  status: number;
  body: unknown;
}

export const conventionsMarkdownInput = z.object({
  query: z.array(z.tuple([z.string(), z.string()])),
});

export const conventionsMarkdown = defineAction<typeof conventionsMarkdownInput, { read: () => Promise<ConventionsResponse> }, ConventionsResponse>({
  input: conventionsMarkdownInput,
  http: { method: "GET", path: "/api/conventions", discriminator: "query settings is not 1, format=markdown and either repo is empty or ensure is not 1" },
  mcp: { reason: "The dashboard can copy markdown without the agent-specific framing or refresh behaviour." },
  handler: (_input, context) => context.read(),
});

export const repoConventionsInput = z.object({
  repo: z.string().describe("owner/repo, or a local repo name as shown by repos_list"),
}).meta({ additionalProperties: false });

export interface RepoConventionsContext {
  read: (repo: string) => Promise<ConventionsResponse>;
}

export const repoConventions = defineAction<typeof repoConventionsInput, RepoConventionsContext, ConventionsResponse>({
  input: repoConventionsInput,
  http: { method: "GET", path: "/api/conventions", discriminator: "query settings is not 1, format=markdown, repo is nonempty and ensure=1" },
  mcp: {
    name: "repo_conventions",
    toolset: "repos",
    description: "This repo's team conventions, learned from its PR review comments and its AGENTS.md / CONTRIBUTING. Call it before reviewing a PR in the repo or opening one, and check the code against what it returns. Pass owner/repo (or the local repo folder name). When the repo has none yet it starts mining them in the background — carry on without and say so. Requires the dashboard running.",
  },
  handler: ({ repo }, context) => context.read(repo),
});

export const conventionsListInput = z.object({
  repo: z.string().optional().describe("owner/repo or local repo name; omit for the overview"),
  status: z.enum(["accepted", "rejected"]).optional().describe("With a repo: active rules or rejected candidates; omit for both"),
}).meta({ additionalProperties: false });

export interface ConventionsListContext {
  list: (repo?: string) => Promise<ConventionsResponse>;
}

export interface ConventionsListResult {
  repo?: string;
  response: ConventionsResponse;
}

export const conventionsList = defineAction<typeof conventionsListInput, ConventionsListContext, ConventionsListResult>({
  input: conventionsListInput,
  http: { method: "GET", path: "/api/conventions", discriminator: "query settings is not 1 and format is not markdown" },
  mcp: {
    name: "conventions_list",
    toolset: "repos",
    description: "List repos that have conventions (active and rejected rules, when each was mined). With a repo: every rule with its id, status, evidence links and quoted feedback, plus where the file is stored — the ids are what conventions_review takes. Requires the dashboard running.",
  },
  handler: async ({ repo, status }, context) => {
    const response = await context.list(repo);
    if (!repo || !status || response.status !== 200) return { repo, response };
    const body = response.body as { file?: { rules: { status: string }[] } | null };
    return {
      repo,
      response: body.file
        ? { ...response, body: { ...body, file: { ...body.file, rules: body.file.rules.filter((rule) => rule.status === status) } } }
        : response,
    };
  },
});

export const conventionsMineInput = z.object({
  repo: z.string().describe("owner/repo or local repo name"),
  force: z.boolean().optional().describe("Re-read every recent PR, not just those with new feedback"),
}).meta({ additionalProperties: false });

export interface ConventionsMineContext {
  mine: (input: z.output<typeof conventionsMineInput>) => Promise<ConventionsResponse>;
}

export interface ConventionsMineResult {
  repo: string;
  response: ConventionsResponse;
}

export const conventionsMine = defineAction<typeof conventionsMineInput, ConventionsMineContext, ConventionsMineResult>({
  input: conventionsMineInput,
  http: { method: "POST", path: "/api/conventions", discriminator: "body action=mine" },
  mcp: {
    name: "conventions_mine",
    toolset: "repos",
    description: "Refresh a repo's conventions from its recent PRs now (the Refresh from PRs button). Runs in the background — a model call, a few minutes — and only reads PRs with new review feedback; force:true re-reads every recent PR. Check progress with conventions_list. Requires the dashboard running and the GitHub CLI authenticated.",
  },
  handler: async (input, context) => ({ repo: input.repo, response: await context.mine(input) }),
});

export const conventionsReviewInput = z.object({
  repo: z.string().describe("owner/repo or local repo name"),
  action: z.enum(["accept", "reject", "restore", "edit", "add", "delete", "undo"]),
  ruleId: z.string().optional().describe("Required for everything except add and undo"),
  text: z.string().optional().describe("The rule: required for add, optional for edit"),
  why: z.string().optional(),
  scope: z.string().optional().describe("A path or glob the rule applies to"),
  category: z.enum(["structure", "config", "naming", "testing", "errors", "security", "performance", "style", "process", "other"]).optional(),
  confirm: z.boolean().optional().describe("Must be true for delete"),
  undoToken: z.string().max(2_000).optional().describe("Token returned by accept, reject or restore; required for undo"),
}).meta({ additionalProperties: false });

export type ConventionsReviewBody =
  | { action: "undo"; repo: string; token: string }
  | { action: "add"; repo: string; text: string; why?: string; scope?: string; category?: z.output<typeof conventionsReviewInput>["category"] }
  | { action: "edit"; repo: string; ruleId: string; text?: string; why?: string; scope?: string; category?: z.output<typeof conventionsReviewInput>["category"] }
  | { action: "delete"; repo: string; ruleId: string }
  | { action: "status"; repo: string; ruleId: string; status: "accepted" | "rejected" };

export interface ConventionsReviewContext {
  review: (body: ConventionsReviewBody) => Promise<ConventionsResponse>;
}

export type ConventionsReviewResult =
  | { kind: "rejected"; message: string }
  | { kind: "done"; message: string; response: ConventionsResponse };

export const conventionsReview = defineAction<typeof conventionsReviewInput, ConventionsReviewContext, ConventionsReviewResult>({
  input: conventionsReviewInput,
  http: { method: "POST", path: "/api/conventions", discriminator: "body action is a review action after native review check" },
  mcp: {
    name: "conventions_review",
    toolset: "repos",
    description: "Review one rule, the same actions as the /conventions page: accept, reject (it won't be proposed again), restore (reinstate as active), edit (rewording accepts it), add (a rule you write yourself, accepted), delete (only rules you added; needs confirm:true), undo (revert a decision using its returned undoToken, provided the rule has not changed). Get rule ids from conventions_list. Requires the dashboard running.",
  },
  handler: async ({ repo, action, ruleId, text, why, scope, category, confirm, undoToken }, context) => {
    if (action === "undo") {
      if (!undoToken) return { kind: "rejected", message: "undo needs the undoToken returned by the decision." };
      return { kind: "done", message: `Decision undone in ${repo}.`, response: await context.review({ action: "undo", repo, token: undoToken }) };
    }
    if (action !== "add" && !ruleId) return { kind: "rejected", message: `${action} needs a ruleId — see conventions_list.` };
    if (action === "add" && !text) return { kind: "rejected", message: "add needs the rule text." };
    if (action === "delete" && !confirm) return { kind: "rejected", message: "delete removes a rule you added for good. Pass confirm:true to go ahead." };

    const body: ConventionsReviewBody = action === "add"
      ? { action: "add", repo, text: text!, why, scope, category }
      : action === "edit"
        ? { action: "edit", repo, ruleId: ruleId!, text, why, scope, category }
        : action === "delete"
          ? { action: "delete", repo, ruleId: ruleId! }
          : { action: "status", repo, ruleId: ruleId!, status: ({ accept: "accepted", reject: "rejected", restore: "accepted" } as const)[action] };
    const response = await context.review(body);
    const result = response.body as { undoToken?: string };
    return { kind: "done", response, message: `${action} done${ruleId ? ` for ${ruleId}` : ""} in ${repo}.${result.undoToken ? `\nUndo token: ${result.undoToken}` : ""}` };
  },
});

export const conventionsNativeReviewInput = z.object({
  action: z.enum(["status", "add"]),
  repo: conventionsReviewInput.shape.repo,
  ruleId: conventionsReviewInput.shape.ruleId,
  status: z.enum(["suggested", "accepted", "rejected"]).optional(),
  text: conventionsReviewInput.shape.text,
  why: conventionsReviewInput.shape.why,
  scope: conventionsReviewInput.shape.scope,
  category: conventionsReviewInput.shape.category,
}).meta({ additionalProperties: false });

export interface ConventionsNativeReviewContext {
  review: (input: z.output<typeof conventionsNativeReviewInput>) => Promise<ConventionsResponse>;
}

export const conventionsNativeReview = defineAction<typeof conventionsNativeReviewInput, ConventionsNativeReviewContext, ConventionsResponse>({
  input: conventionsNativeReviewInput,
  http: { method: "POST", path: "/api/conventions", discriminator: "body action=status with status=suggested or action=add without text" },
  mcp: { reason: "The dashboard supports suggested status and its legacy validation; MCP review has separate confirmation and input guards." },
  handler: (input, context) => context.review(input),
});

export const conventionsSettingsInput = z.object({
  enabled: z.boolean().optional().describe("Automatic mining on or off; manual refresh always works"),
  prLimit: z.number().int().min(5).max(50).optional(),
  minIntervalHours: z.number().int().min(1).max(168).optional(),
  provider: z.string().optional().describe("cursor-cli | chatgpt-cli | antigravity-cli | opencode | api; empty string = the default provider"),
  model: z.string().optional().describe("Model for mining; empty string = the provider's own"),
  effort: z.string().max(32).optional().describe("Reasoning effort. Empty string clears it."),
}).meta({ additionalProperties: false });

export interface ConventionsSettingsContext {
  read: () => Promise<ConventionsResponse>;
  save: (input: z.output<typeof conventionsSettingsInput>) => Promise<ConventionsResponse>;
}

export interface ConventionsSettingsResult {
  saved: boolean;
  response: ConventionsResponse;
}

export const conventionsSettings = defineAction<typeof conventionsSettingsInput, ConventionsSettingsContext, ConventionsSettingsResult>({
  input: conventionsSettingsInput,
  http: { method: "POST", path: "/api/conventions", discriminator: "body action=prefs and prefs match nonempty MCP settings" },
  mcp: {
    name: "conventions_settings",
    toolset: "repos",
    description: "Read the conventions settings, or change them by passing any fields (the page's Settings panel): mining on/off, PRs read per run, the minimum gap between automatic runs, and the provider and model used for mining. With no fields it just reads. Requires the dashboard running.",
  },
  handler: async (input, context) => {
    const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    if (Object.keys(patch).length === 0) return { saved: false, response: await context.read() };
    return { saved: true, response: await context.save(patch) };
  },
});

export const conventionsSettingsReadInput = z.object({}).meta({ additionalProperties: false });

export const conventionsSettingsRead = defineAction<typeof conventionsSettingsReadInput, Pick<ConventionsSettingsContext, "read">, ConventionsResponse>({
  input: conventionsSettingsReadInput,
  http: { method: "GET", path: "/api/conventions", discriminator: "query settings=1" },
  mcp: { reason: "Reading settings is included in the conventions_settings tool." },
  handler: (_input, context) => context.read(),
});

export const conventionsNativeSettingsInput = conventionsSettingsInput.extend({
  prLimit: z.number().int().optional(),
  minIntervalHours: z.number().int().optional(),
  provider: conventionsSettingsInput.shape.provider.unwrap().max(40).optional(),
  model: conventionsSettingsInput.shape.model.unwrap().max(120).optional(),
}).meta({ additionalProperties: false });

export const conventionsNativeSettings = defineAction<typeof conventionsNativeSettingsInput, { save: (input: z.output<typeof conventionsNativeSettingsInput>) => Promise<ConventionsResponse> }, ConventionsResponse>({
  input: conventionsNativeSettingsInput,
  http: { method: "POST", path: "/api/conventions", discriminator: "body action=prefs and prefs do not match nonempty MCP settings" },
  mcp: { reason: "The dashboard also accepts empty settings patches and clamps a wider range of numeric values." },
  handler: (input, context) => context.save(input),
});
