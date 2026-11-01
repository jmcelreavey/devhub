import { z } from "zod";
import { defineAction } from "./define.ts";

export const prAutoReviewReadInput = z.object({ scope: z.string().nullable() });
export const prAutoReviewRead = defineAction<typeof prAutoReviewReadInput, { read: (scope: string | null) => Promise<unknown> }, unknown>({
  input: prAutoReviewReadInput,
  http: { method: "GET", path: "/api/github/prs/auto-review" },
  mcp: { reason: "The dashboard previews review candidates and incomplete local reviews." },
  handler: ({ scope }, context) => context.read(scope),
});

export const prOpenInput = z.object({
  repo: z.string().describe("owner/repo, e.g. acme/widgets"),
  number: z.number().int().positive().describe("PR number"),
  notePath: z.string().optional().describe("Optional notes-relative path (e.g. pr-reviews/acme-widgets-9) to open alongside"),
  confirm: z.boolean().optional().describe("Required true to stash/checkout and launch Cursor"),
}).meta({ additionalProperties: false });

export interface PrOpenResponse {
  status: number;
  body: unknown;
}

export const jiraTicketsInput = z.object({}).meta({ additionalProperties: false });
export const jiraTickets = defineAction<typeof jiraTicketsInput, { list: () => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: jiraTicketsInput,
  http: { method: "GET", path: "/api/jira/tickets" },
  mcp: {
    name: "jira_tickets",
    toolset: "work",
    description: "List my assigned Jira tickets via the dashboard. Requires the dashboard running and Jira configured in /setup.",
  },
  handler: (_input, context) => context.list(),
});

export const jiraTicketGetInput = z.object({
  key: z.string().describe("Jira ticket key, e.g. XYZ-1234"),
}).meta({ additionalProperties: false });
export const jiraTicketGet = defineAction<typeof jiraTicketGetInput, { get: (key: string) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: jiraTicketGetInput,
  http: { method: "GET", path: "/api/jira/ticket/[key]" },
  mcp: {
    name: "jira_ticket_get",
    toolset: "work",
    description: "Fetch a single Jira ticket (status, summary, issue type) by key, e.g. XYZ-1234. Requires the dashboard running.",
  },
  handler: ({ key }, context) => context.get(key),
});

export const jiraCreateDashboardInput = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/, "projectKey must be a Jira project key"),
  summary: z.string().min(1, "summary is required").max(255),
  description: z.string().min(1, "description is required").max(5000),
  parentKey: z.union([z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/), z.null()]).optional(),
  issuetypeName: z.string().min(1).max(60).optional(),
  assignToMe: z.boolean().optional(),
  sprintId: z.union([z.number().int().positive(), z.null()]).optional(),
});
export const jiraTicketCreateInput = z.object({
  projectKey: z.string().trim().regex(/^[A-Z][A-Z0-9]+$/).describe("Jira project key, e.g. ABC"),
  summary: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(5000).describe("Issue description in Markdown"),
  parentKey: z.string().regex(/^[A-Z][A-Z0-9]+-[0-9]+$/).nullable().optional(),
  assignToMe: z.boolean().optional().describe("Assign to the configured Jira user (default true)"),
  sprintId: z.number().int().positive().nullable().optional(),
  confirm: z.boolean().optional().describe("Required true to create the issue after user approval"),
}).meta({ additionalProperties: false });

export interface WorkWriteResponse extends PrOpenResponse {
  headers?: Record<string, string>;
}
export interface JiraCreateContext {
  create: (input: z.output<typeof jiraCreateDashboardInput>) => Promise<WorkWriteResponse>;
}
export type JiraCreateResult =
  | { kind: "preview"; input: z.output<typeof jiraTicketCreateInput> }
  | { kind: "created"; input: z.output<typeof jiraTicketCreateInput>; response: WorkWriteResponse };

export const jiraTicketCreate = defineAction<typeof jiraTicketCreateInput, JiraCreateContext, JiraCreateResult>({
  input: jiraTicketCreateInput,
  http: { method: "POST", path: "/api/jira/issue", discriminator: "body matches MCP create input without issuetypeName or field transformations" },
  mcp: {
    name: "jira_ticket_create",
    toolset: "work",
    description: "Create a Jira ticket immediately through the authenticated dashboard when confirm:true. It chooses Task/Sub-task from the parent and inherits its Team. Each call creates a new issue; check Jira before retrying an uncertain result.",
  },
  handler: async (input, context) => {
    if (!input.confirm) return { kind: "preview", input };
    const { confirm: _confirm, ...body } = input;
    void _confirm;
    return { kind: "created", input, response: await context.create(body) };
  },
});
export const jiraCreateDashboard = defineAction<typeof jiraCreateDashboardInput, JiraCreateContext, WorkWriteResponse>({
  input: jiraCreateDashboardInput,
  http: { method: "POST", path: "/api/jira/issue", discriminator: "body does not match MCP create branch" },
  mcp: { reason: "The dashboard accepts its existing untrimmed form fields and issue-type option." },
  handler: (input, context) => context.create(input),
});

export const jiraTransitionBodyInput = z.object({
  transitionId: z.string().min(1).optional(),
  toStatusId: z.string().regex(/^[0-9]+$/).optional(),
}).refine((value) => Boolean(value.transitionId) !== Boolean(value.toStatusId), "Send either transitionId or toStatusId.");
export const jiraTicketTransitionInput = z.object({
  key: z.string().describe("Jira ticket key, e.g. XYZ-1234"),
  transitionId: z.string().optional().describe("Transition id (from the listing). Omit to list options."),
  confirm: z.boolean().optional().describe("Required (true) to actually apply the transition"),
}).meta({ additionalProperties: false });
export const jiraTransitionDashboardInput = z.object({ key: z.string(), body: jiraTransitionBodyInput });
export interface JiraTransitionContext {
  list: (key: string) => Promise<WorkWriteResponse>;
  move: (key: string, body: z.output<typeof jiraTransitionBodyInput>) => Promise<WorkWriteResponse>;
}
export type JiraTransitionResult =
  | { kind: "list"; key: string; response: WorkWriteResponse }
  | { kind: "preview"; key: string; transitionId: string }
  | { kind: "moved"; key: string; transitionId: string; response: WorkWriteResponse };
export const jiraTicketTransition = defineAction<typeof jiraTicketTransitionInput, JiraTransitionContext, JiraTransitionResult>({
  input: jiraTicketTransitionInput,
  http: { method: "POST", path: "/api/jira/ticket/[key]/transition", discriminator: "body transitionId is nonempty" },
  mcp: {
    name: "jira_ticket_transition",
    toolset: "work",
    description: "Apply a Jira workflow transition immediately with confirm:true. Call without transitionId to list available transitions. Requires the dashboard running.",
  },
  handler: async ({ key, transitionId, confirm }, context) => {
    if (!transitionId) return { kind: "list", key, response: await context.list(key) };
    if (!confirm) return { kind: "preview", key, transitionId };
    return { kind: "moved", key, transitionId, response: await context.move(key, { transitionId }) };
  },
});
export const jiraTransitionDashboard = defineAction<typeof jiraTransitionDashboardInput, Pick<JiraTransitionContext, "move">, WorkWriteResponse>({
  input: jiraTransitionDashboardInput,
  http: { method: "POST", path: "/api/jira/ticket/[key]/transition", discriminator: "body transitionId is empty or absent" },
  mcp: { reason: "The dashboard's undo workflow selects a transition by destination status." },
  handler: ({ key, body }, context) => context.move(key, body),
});
export const jiraTransitionsListInput = jiraTicketGetInput;
export const jiraTransitionsList = defineAction<typeof jiraTransitionsListInput, Pick<JiraTransitionContext, "list">, WorkWriteResponse>({
  input: jiraTransitionsListInput,
  http: { method: "GET", path: "/api/jira/ticket/[key]/transitions" },
  mcp: { reason: "The existing jira_ticket_transition tool lists transitions when no transition is supplied." },
  handler: ({ key }, context) => context.list(key),
});

export const jiraAssignBodyInput = z.object({ assignee: z.string().trim().min(1).max(200).optional() });
export const jiraTicketAssignInput = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).describe("Jira ticket key, e.g. XYZ-1234"),
  assignee: z.string().trim().min(1).max(200).optional().describe("'me' (default), a Jira accountId, or a name/email"),
  confirm: z.boolean().optional().describe("Required (true) to actually assign"),
}).meta({ additionalProperties: false });
export const jiraAssignDashboardInput = z.object({ key: z.string(), assignee: jiraAssignBodyInput.shape.assignee });
export interface JiraAssignContext {
  assign: (key: string, assignee: string) => Promise<WorkWriteResponse>;
}
export type JiraAssignResult =
  | { kind: "preview"; key: string; assignee: string }
  | { kind: "assigned"; key: string; assignee: string; response: WorkWriteResponse };
export const jiraTicketAssign = defineAction<typeof jiraTicketAssignInput, JiraAssignContext, JiraAssignResult>({
  input: jiraTicketAssignInput,
  http: { method: "POST", path: "/api/jira/ticket/[key]/assign", discriminator: "body matches MCP assign input" },
  mcp: {
    name: "jira_ticket_assign",
    toolset: "work",
    description: "Assign a Jira ticket immediately with confirm:true. assignee defaults to 'me' (the authenticated Jira user); also accepts a Jira accountId or a name/email that matches exactly one user. Check the current assignee with jira_ticket_get first. Requires the dashboard running.",
  },
  handler: async ({ key, assignee, confirm }, context) => {
    const who = assignee ?? "me";
    if (!confirm) return { kind: "preview", key, assignee: who };
    return { kind: "assigned", key, assignee: who, response: await context.assign(key, who) };
  },
});
export const jiraAssignDashboard = defineAction<typeof jiraAssignDashboardInput, JiraAssignContext, WorkWriteResponse>({
  input: jiraAssignDashboardInput,
  http: { method: "POST", path: "/api/jira/ticket/[key]/assign", discriminator: "body does not match MCP assign input" },
  mcp: { reason: "The dashboard leaves ticket-key validation to its Jira integration." },
  handler: ({ key, assignee }, context) => context.assign(key, assignee ?? "me"),
});

export const standupMarkdownInput = z.object({
  startDate: z.string().optional().describe("Range start YYYY-MM-DD (default: yesterday)"),
  endDate: z.string().optional().describe("Range end YYYY-MM-DD (default: today)"),
}).meta({ additionalProperties: false });

export interface StandupResponse extends PrOpenResponse {
  headers?: Record<string, string>;
}
export interface StandupContext {
  read: (input: z.output<typeof standupMarkdownDashboardInput>) => Promise<StandupResponse>;
}

export const standupMarkdown = defineAction<typeof standupMarkdownInput, StandupContext, StandupResponse>({
  input: standupMarkdownInput,
  http: { method: "GET", path: "/api/standup/markdown", discriminator: "query has no startTime, endTime or excludeRepos" },
  mcp: {
    name: "standup_markdown",
    toolset: "work",
    description: "Generate a standup digest (commits, merged/authored PRs, Jira activity, tasks) as markdown via the dashboard. Defaults to yesterday→today. Requires the dashboard running.",
  },
  handler: (input, context) => context.read(input),
});

export const standupMarkdownDashboardInput = standupMarkdownInput.extend({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  excludeRepos: z.string().optional(),
});
export const standupMarkdownDashboard = defineAction<typeof standupMarkdownDashboardInput, StandupContext, StandupResponse>({
  input: standupMarkdownDashboardInput,
  http: { method: "GET", path: "/api/standup/markdown", discriminator: "query has startTime, endTime or excludeRepos" },
  mcp: { reason: "Custom times and repository exclusions are dashboard standup controls." },
  handler: (input, context) => context.read(input),
});

export const tasksWeeklyInput = z.object({
  end: z.string().optional().describe("End date YYYY-MM-DD (defaults to today; covers the 7 days ending then)"),
}).meta({ additionalProperties: false });
export const tasksWeekly = defineAction<typeof tasksWeeklyInput, { read: (end?: string) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: tasksWeeklyInput,
  http: { method: "GET", path: "/api/tasks/weekly" },
  mcp: {
    name: "tasks_weekly",
    toolset: "work",
    description: "Weekly task review: per-day created/completed/abandoned/moved totals plus slipped (repeatedly-moved) tasks, ending on a given date. Requires the dashboard running.",
  },
  handler: ({ end }, context) => context.read(end),
});

export const prListInput = z.object({}).passthrough();

export interface PrListContext {
  list: (details: boolean) => Promise<PrOpenResponse>;
}

export const prList = defineAction<typeof prListInput, PrListContext, PrOpenResponse>({
  input: prListInput,
  http: { method: "GET", path: "/api/github/prs", discriminator: "query details is not 1" },
  mcp: {
    name: "prs_list",
    toolset: "work",
    description: "List my open GitHub PRs (authored + awaiting my review) via the dashboard, including a CI checks glance (passing/failing/pending/none + counts) when available. Stash+checkout with prs_open_in_cursor; auto agent-review with prs_auto_review; toggle the poller with prs_auto_review_settings_get/set; dig into red builds with prs_pipeline_investigate. Pair with events_wait (kind=pr) / pr-state for live check waits. Requires the dashboard running and the GitHub CLI authenticated.",
  },
  handler: (_input, context) => context.list(false),
});

export const prListDetailsInput = z.object({ details: z.literal(true) });

export const prListDetails = defineAction<typeof prListDetailsInput, PrListContext, PrOpenResponse>({
  input: prListDetailsInput,
  http: { method: "GET", path: "/api/github/prs", discriminator: "query details=1" },
  mcp: { reason: "The dashboard's detailed PR list is not exposed by the existing MCP tool." },
  handler: (_input, context) => context.list(true),
});

export interface PrOpenContext {
  open: (input: Omit<z.output<typeof prOpenInput>, "confirm">) => Promise<PrOpenResponse>;
}

export type PrOpenResult =
  | { kind: "preview"; repo: string; number: number; notePath?: string }
  | { kind: "opened"; repo: string; number: number; response: PrOpenResponse };

export const prOpen = defineAction<typeof prOpenInput, PrOpenContext, PrOpenResult>({
  input: prOpenInput,
  http: { method: "POST", path: "/api/github/prs/open-in-cursor" },
  mcp: {
    name: "prs_open_in_cursor",
    toolset: "work",
    description: "Open a PR in Cursor: stash dirty work in the local clone, gh pr checkout, then launch Cursor on that repo (same as the PR row Open in Cursor action). Optional notePath also opens a notes working copy. Mutates git — requires confirm:true. Requires the dashboard running. repos_open only opens the current branch.",
  },
  handler: async ({ repo, number, notePath, confirm }, context) => {
    if (!confirm) return { kind: "preview", repo, number, notePath };
    return { kind: "opened", repo, number, response: await context.open({ repo, number, notePath }) };
  },
});

export const prPipelineInvestigateInput = z.object({
  repo: prOpenInput.shape.repo,
  number: prOpenInput.shape.number,
  url: z.string().optional().describe("Optional full PR URL"),
  title: z.string().optional().describe("Optional PR title for the session label"),
  confirm: z.boolean().optional().describe("Required true to start the agent (and optional re-run)"),
  rerunFailed: z.boolean().optional().describe("With confirm:true, also re-run failed Actions for the PR head branch"),
  dryRun: z.boolean().optional().describe("Force preview even if confirm is set"),
}).meta({ additionalProperties: false });

export interface PrPipelineInvestigateContext {
  investigate: (input: z.output<typeof prPipelineInvestigateInput>, mayStart: boolean) => Promise<PrOpenResponse>;
}

export const prPipelineInvestigate = defineAction<typeof prPipelineInvestigateInput, PrPipelineInvestigateContext, PrOpenResponse>({
  input: prPipelineInvestigateInput,
  http: { method: "POST", path: "/api/github/prs/pipeline-investigate" },
  mcp: {
    name: "prs_pipeline_investigate",
    toolset: "work",
    description: "Investigate CI/checks for one PR (same prompt/note path as the UI Investigate pipeline action). Uses the devhub-fix-pipeline skill via OpenCode — classifies flake vs real, may fix on the branch, writes findings to the PR review note. Never posts GitHub review comments. Dry-run / preview by default; pass confirm:true to start. Optional rerunFailed:true (with confirm) re-runs failed Actions on the PR head branch first. Prefer prs_list for queue glance, and events_wait (kind=pr, until=checks_done) / GET /api/github/pr-state for live waits. Requires the dashboard running and gh authenticated.",
  },
  handler: (input, context) => context.investigate(input, input.confirm === true && input.dryRun !== true),
});

export const prAutoReviewInput = z.object({
  confirm: z.boolean().optional().describe("Required true to start reviews; omit or false for dry-run candidate listing"),
  limit: z.number().int().min(1).max(2).optional().describe("Max reviews to start this call (1–2)"),
}).meta({ additionalProperties: false });

export interface PrAutoReviewContext {
  review: (input: { dryRun: boolean; limit?: number }) => Promise<PrOpenResponse>;
}

export interface PrAutoReviewResult {
  dryRun: boolean;
  response: PrOpenResponse;
}

export const prAutoReview = defineAction<typeof prAutoReviewInput, PrAutoReviewContext, PrAutoReviewResult>({
  input: prAutoReviewInput,
  http: { method: "POST", path: "/api/github/prs/auto-review", discriminator: "body has no url" },
  mcp: {
    name: "prs_auto_review",
    toolset: "work",
    description: "Auto agent-review for review-requested PRs (same prompt/note path as the UI Review with agent action). Skips drafts, skip-until-updated PRs, and PRs already reviewed for the current updatedAt. Never posts GitHub review comments — only starts OpenCode review jobs that write notes under pr-reviews/. Dry-run by default; pass confirm:true to start (capped concurrency 1–2). Requires the dashboard running and gh authenticated.",
  },
  handler: async ({ confirm, limit }, context) => {
    const dryRun = !confirm;
    return { dryRun, response: await context.review({ dryRun, ...(limit !== undefined ? { limit } : {}) }) };
  },
});

export const prAutoReviewTargetInput = z.object({
  dryRun: z.boolean().optional(),
  limit: prAutoReviewInput.shape.limit,
  url: z.string().url().max(500).optional(),
}).meta({ additionalProperties: false });

export const prAutoReviewTarget = defineAction<typeof prAutoReviewTargetInput, { review: (input: z.output<typeof prAutoReviewTargetInput>) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: prAutoReviewTargetInput,
  http: { method: "POST", path: "/api/github/prs/auto-review", discriminator: "body has url" },
  mcp: { reason: "The dashboard can target a specific review; MCP exposes only the general review pass." },
  handler: (input, context) => context.review(input),
});

export const prAutoReviewSettingsGetInput = z.object({}).passthrough();

export const prAutoReviewSettingsGet = defineAction<typeof prAutoReviewSettingsGetInput, { read: () => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: prAutoReviewSettingsGetInput,
  http: { method: "GET", path: "/api/github/prs/auto-review/settings" },
  mcp: {
    name: "prs_auto_review_settings_get",
    toolset: "work",
    description: "Read auto agent-review poller settings (enabled / always / source / intervalMs). Prefs live in notes/.config/auto-pr-review.json once saved; before that, values come from DEVHUB_AUTO_PR_REVIEW / DEVHUB_AUTO_PR_REVIEW_ALWAYS. Requires the dashboard running.",
  },
  handler: (_input, context) => context.read(),
});

export const prAutoReviewSettingsSetInput = z.object({
  enabled: z.boolean().optional().describe("Turn the in-process poller on or off"),
  always: z.boolean().optional().describe("When true, skip the weekday daytime window"),
}).meta({ additionalProperties: false });

export interface PrAutoReviewSettingsSetContext {
  save: (input: z.output<typeof prAutoReviewSettingsSetInput>) => Promise<PrOpenResponse>;
}

export type PrAutoReviewSettingsSetResult =
  | { kind: "missing" }
  | { kind: "saved"; response: PrOpenResponse };

export const prAutoReviewSettingsSet = defineAction<typeof prAutoReviewSettingsSetInput, PrAutoReviewSettingsSetContext, PrAutoReviewSettingsSetResult>({
  input: prAutoReviewSettingsSetInput,
  http: { method: "PUT", path: "/api/github/prs/auto-review/settings", discriminator: "body has no ownedOnly" },
  mcp: {
    name: "prs_auto_review_settings_set",
    toolset: "work",
    description: "Set auto agent-review poller prefs (enabled / always) via the dashboard. Persists to notes/.config/auto-pr-review.json (prefs then win over env). Takes effect on the next poller tick (kicked immediately after save). Requires the dashboard running.",
  },
  handler: async ({ enabled, always }, context) => {
    if (enabled === undefined && always === undefined) return { kind: "missing" };
    const input = { ...(enabled !== undefined ? { enabled } : {}), ...(always !== undefined ? { always } : {}) };
    return { kind: "saved", response: await context.save(input) };
  },
});

export const prAutoReviewSettingsNativeInput = prAutoReviewSettingsSetInput.extend({ ownedOnly: z.boolean().optional() }).meta({ additionalProperties: false });

export const prAutoReviewSettingsNative = defineAction<typeof prAutoReviewSettingsNativeInput, { save: (input: z.output<typeof prAutoReviewSettingsNativeInput>) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: prAutoReviewSettingsNativeInput,
  http: { method: "PUT", path: "/api/github/prs/auto-review/settings", discriminator: "body has ownedOnly" },
  mcp: { reason: "The owned-only poller setting is currently available only in the dashboard." },
  handler: (input, context) => context.save(input),
});

export const prSkippedListInput = z.object({});
export const prSkippedList = defineAction<typeof prSkippedListInput, { list: () => unknown }, unknown>({
  input: prSkippedListInput,
  http: { method: "GET", path: "/api/github/prs/skip" },
  mcp: { reason: "The skipped-review list is a dashboard-only preference." },
  handler: (_input, context) => context.list(),
});

export const prSkipInput = z.object({
  url: z.string().trim().startsWith("https://"),
  updatedAt: z.string().optional(),
  repo: z.string().default(""),
  number: z.number().default(0),
  title: z.string().default(""),
  kind: z.enum(["authored", "reviews"]).optional(),
});
export const prSkip = defineAction<typeof prSkipInput, { skip: (input: z.output<typeof prSkipInput>) => Promise<void> }, { ok: true }>({
  input: prSkipInput,
  http: { method: "POST", path: "/api/github/prs/skip" },
  mcp: { reason: "Skipping a review is a dashboard-only preference." },
  handler: async (input, context) => { await context.skip(input); return { ok: true }; },
});

export const prUnskipInput = z.object({ url: z.string().min(1) });
export const prUnskip = defineAction<typeof prUnskipInput, { unskip: (url: string) => Promise<void> }, { ok: true }>({
  input: prUnskipInput,
  http: { method: "DELETE", path: "/api/github/prs/skip" },
  mcp: { reason: "Restoring a skipped review is a dashboard-only preference." },
  handler: async ({ url }, context) => { await context.unskip(url); return { ok: true }; },
});

export const prOwnedListInput = z.object({});
export const prOwnedList = defineAction<typeof prOwnedListInput, { load: () => Promise<unknown> }, unknown>({
  input: prOwnedListInput,
  http: { method: "GET", path: "/api/github/prs/owned", discriminator: "query scope is not remote" },
  mcp: { reason: "The owned-PR panel is a dashboard-specific view." },
  handler: (_input, context) => context.load(),
});

export const prOwnedRemoteInput = z.object({
  repos: z.array(z.string().max(255).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).refine((repo) =>
    !repo.startsWith("-") && repo.split("/").every((part) => part !== "." && part !== ".."),
  )).max(256),
});
export const prOwnedRemote = defineAction<typeof prOwnedRemoteInput, { load: (repos: string[]) => Promise<unknown> }, unknown>({
  input: prOwnedRemoteInput,
  http: { method: "GET", path: "/api/github/prs/owned", discriminator: "query scope=remote" },
  mcp: { reason: "Remote owned-PR refresh is an authenticated dashboard-internal operation." },
  handler: ({ repos }, context) => context.load([...new Set(repos)]),
});

export const prRepoPattern = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
export const prStateInput = z.object({
  repo: z.string().regex(prRepoPattern),
  number: z.number().refine((value) => Number.isInteger(value) && value > 0),
});
export const prState = defineAction<typeof prStateInput, { read: (repo: string, number: number) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: prStateInput,
  http: { method: "GET", path: "/api/github/pr-state" },
  mcp: { reason: "The authenticated PR-state endpoint supports event waiting rather than a standalone tool." },
  handler: ({ repo, number }, context) => context.read(repo, number),
});

export const prSearchInput = z.object({ query: z.string().trim().transform((query) => query.slice(0, 200)) });
export const prSearch = defineAction<typeof prSearchInput, { search: (query: string) => Promise<PrOpenResponse> }, PrOpenResponse>({
  input: prSearchInput,
  http: { method: "GET", path: "/api/github/prs/search" },
  mcp: { reason: "The interactive PR search panel is a dashboard-specific view." },
  handler: ({ query }, context) => context.search(query),
});
