import { z } from "zod";
import { defineAction } from "./define.ts";

export const reposListInput = z.object({}).meta({ additionalProperties: false });

export interface ReposListItem {
  name: string;
  branch: string | null;
  dirtyCount: number;
  unpushedCount: number;
  hasCompose?: boolean;
}

export interface ReposListResult {
  repos: ReposListItem[];
  scanDirDisplay?: string;
}

export interface ReposListContext {
  list: () => Promise<ReposListResult>;
}

export const reposList = defineAction<typeof reposListInput, ReposListContext, ReposListResult>({
  input: reposListInput,
  http: { method: "GET", path: "/api/repos" },
  mcp: {
    name: "repos_list",
    toolset: "repos",
    description: "List the local repos DevHub tracks, with branch, dirty-file count, and unpushed-commit count. Requires the dashboard running.",
  },
  handler: (_input, context) => context.list(),
});

export const repoCloneInput = z.object({
  fullName: z.string().trim().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "fullName must look like owner/repo")
    .describe("GitHub owner/repo, e.g. acme/widgets"),
}).meta({ additionalProperties: false });

export const repoInitInput = z.object({ name: z.string().trim().min(1).max(100) });
export const repoInit = defineAction<typeof repoInitInput, { init: (name: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoInitInput,
  http: { method: "POST", path: "/api/repos/init" },
  mcp: { reason: "Creating an empty local repository is a dashboard-only operation." },
  handler: ({ name }, context) => context.init(name),
});

export const repoCloneRemoteInput = z.object({
  url: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(100).optional(),
}).meta({ additionalProperties: false });

export interface RepoCloneContext {
  clone: (input: z.output<typeof repoCloneInput>) => Promise<RepoGitResponse>;
}

export interface RepoCloneRemoteContext {
  clone: (input: z.output<typeof repoCloneRemoteInput>) => Promise<RepoGitResponse>;
}

export interface RepoCloneResult {
  fullName: string;
  response: RepoGitResponse;
}

export const repoClone = defineAction<typeof repoCloneInput, RepoCloneContext, RepoCloneResult>({
  input: repoCloneInput,
  http: { method: "POST", path: "/api/repos/clone", discriminator: "body has fullName" },
  mcp: {
    name: "repos_clone",
    toolset: "repos",
    description: "Clone a GitHub repo into the DevHub repos directory. Requires the dashboard running and gh/git available.",
  },
  handler: async (input, context) => ({ fullName: input.fullName, response: await context.clone(input) }),
});

export const repoCloneRemote = defineAction<typeof repoCloneRemoteInput, RepoCloneRemoteContext, RepoGitResponse>({
  input: repoCloneRemoteInput,
  http: { method: "POST", path: "/api/repos/clone", discriminator: "body has no fullName" },
  mcp: { reason: "The MCP clone tool only accepts a GitHub owner/repo, not arbitrary remote URLs." },
  handler: (input, context) => context.clone(input),
});

export const repoOpenInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
}).meta({ additionalProperties: false });

export const repoDashboardQueryInput = repoOpenInput.extend({
  query: z.array(z.tuple([z.string(), z.string()])),
});

interface RepoDashboardQueryContext {
  read: (input: z.output<typeof repoDashboardQueryInput>) => Promise<RepoGitHttpResponse>;
}

function repoDashboardQuery(path: string, reason: string) {
  return defineAction<typeof repoDashboardQueryInput, RepoDashboardQueryContext, RepoGitHttpResponse>({
    input: repoDashboardQueryInput,
    http: { method: "GET", path, discriminator: "query uses dashboard fallback" },
    mcp: { reason },
    handler: (input, context) => context.read(input),
  });
}

export const repoGitLogDashboardInput = repoDashboardQueryInput;
export const repoGitLogDashboard = repoDashboardQuery("/api/repos/[name]/git/log", "Extended graph and filter options are a dashboard history view.");
export const repoGitShowDashboardInput = repoDashboardQueryInput;
export const repoGitShowDashboard = repoDashboardQuery("/api/repos/[name]/git/show", "Extended commit display options are a dashboard view.");
export const repoGitDiffDashboardInput = repoDashboardQueryInput;
export const repoGitDiffDashboard = repoDashboardQuery("/api/repos/[name]/git/diff", "Extended working-tree diff options are a dashboard view.");
export const repoGitBlameDashboardInput = repoDashboardQueryInput;
export const repoGitBlameDashboard = repoDashboardQuery("/api/repos/[name]/git/blame", "Extended blame options are a dashboard view.");
export const repoGitRangeDashboardInput = repoDashboardQueryInput;
export const repoGitRangeDashboard = repoDashboardQuery("/api/repos/[name]/git/range", "Extended range diff options are a dashboard view.");
export const repoGitCiDashboardInput = repoDashboardQueryInput;
export const repoGitCiDashboard = repoDashboardQuery("/api/repos/[name]/git/ci", "The dashboard validates commit-specific CI requests independently.");
export const repoLearnDashboardInput = repoDashboardQueryInput;
export const repoLearnDashboard = repoDashboardQuery("/api/repos/[name]/learn", "Domain and ownership learning views are dashboard-specific.");
export const repoWorktreesDashboardInput = repoDashboardQueryInput;
export const repoWorktreesDashboard = repoDashboardQuery("/api/repos/[name]/worktrees", "Task-scoped worktree inventory is a dashboard-specific view.");

export const repoGitDashboardBranchInput = repoOpenInput.extend({
  body: z.looseObject({
    action: z.enum([
      "checkout", "checkout-remote", "stash-save", "stash-apply", "discard", "commit", "push",
      "force-push-with-lease", "set-upstream", "merge-branch", "rebase-branch", "branch-from",
      "rename-branch", "reset-to-branch", "fetch", "pull", "pull-rebase", "pull-merge",
      "prune-backup-branches", "sync-main", "create-branch", "delete-branch", "undo-commit",
      "reset-stash-ahead",
    ]),
  }),
});

export const repoGitDashboardBranch = defineAction<typeof repoGitDashboardBranchInput, { mutate: () => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitDashboardBranchInput,
  http: { method: "POST", path: "/api/repos/[name]/branches", discriminator: "body matches dashboard branch input after branch and commit checks" },
  mcp: { reason: "Interactive branch workflows and their dashboard confirmations are not exposed as additional MCP actions." },
  handler: (_input, context) => context.mutate(),
});

export interface RepoDashboardReadContext {
  read: (name: string) => Promise<RepoGitResponse>;
}

export const repoDetailInput = repoOpenInput;
export const repoDetail = defineAction<typeof repoDetailInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoDetailInput,
  http: { method: "GET", path: "/api/repos/[name]" },
  mcp: { reason: "The individual repository card is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoDeleteInput = repoOpenInput;
export const repoDelete = defineAction<typeof repoDeleteInput, { remove: (name: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoDeleteInput,
  http: { method: "DELETE", path: "/api/repos/[name]" },
  mcp: { reason: "Deleting a local repository is an interactive dashboard operation, not an MCP tool." },
  handler: ({ name }, context) => context.remove(name),
});

export const repoWorktreeReportInput = z.object({});
export const repoWorktreeReport = defineAction<typeof repoWorktreeReportInput, { read: () => unknown }, unknown>({
  input: repoWorktreeReportInput,
  http: { method: "GET", path: "/api/repos/worktree-report" },
  mcp: { reason: "The authenticated worktree report is a dashboard-internal view." },
  handler: (_input, context) => context.read(),
});

export const repoAppsInput = z.object({});
export const repoApps = defineAction<typeof repoAppsInput, { read: () => Promise<unknown> }, unknown>({
  input: repoAppsInput,
  http: { method: "GET", path: "/api/repos/apps" },
  mcp: { reason: "Installed repo-opening applications are local dashboard UI capabilities." },
  handler: (_input, context) => context.read(),
});

export const repoGithubListInput = z.object({ query: z.string().optional() });
export const repoGithubList = defineAction<typeof repoGithubListInput, { list: (query?: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGithubListInput,
  http: { method: "GET", path: "/api/repos/github" },
  mcp: { reason: "The repository picker search is a dashboard-specific view." },
  handler: ({ query }, context) => context.list(query),
});

export const repoNotesInput = repoOpenInput;
export const repoNotes = defineAction<typeof repoNotesInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoNotesInput,
  http: { method: "GET", path: "/api/repos/[name]/notes" },
  mcp: { reason: "The repository's notes panel is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitFilesInput = repoOpenInput;
export const repoGitFiles = defineAction<typeof repoGitFilesInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoGitFilesInput,
  http: { method: "GET", path: "/api/repos/[name]/git/files" },
  mcp: { reason: "Tracked-file picker data is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitPeopleInput = repoOpenInput;
export const repoGitPeople = defineAction<typeof repoGitPeopleInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoGitPeopleInput,
  http: { method: "GET", path: "/api/repos/[name]/git/people" },
  mcp: { reason: "Contributor picker data is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitBranchPrsInput = repoOpenInput;
export const repoGitBranchPrs = defineAction<typeof repoGitBranchPrsInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoGitBranchPrsInput,
  http: { method: "GET", path: "/api/repos/[name]/git/branch-prs" },
  mcp: { reason: "The branch-rail PR summary is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitReflogInput = repoOpenInput.extend({ limit: z.string() });
export const repoGitReflog = defineAction<typeof repoGitReflogInput, { read: (name: string, limit: number) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitReflogInput,
  http: { method: "GET", path: "/api/repos/[name]/git/reflog" },
  mcp: { reason: "Reflog recovery data is a dashboard-only Git view." },
  handler: ({ name, limit }, context) => {
    const value = Number(limit);
    return context.read(name, Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 10), 500) : 100);
  },
});

export const repoGitRemotesInput = repoOpenInput;
export const repoGitRemotes = defineAction<typeof repoGitRemotesInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoGitRemotesInput,
  http: { method: "GET", path: "/api/repos/[name]/git/remotes" },
  mcp: { reason: "Remote configuration is a dashboard-only Git view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitRemoteChangeInput = z.object({
  repo: z.string(),
  action: z.enum(["add", "rename", "remove", "set-url"]),
  name: z.string().min(1).max(100),
  newName: z.string().min(1).max(100).optional(),
  url: z.string().min(1).max(2048).optional(),
});
export const repoGitRemoteChange = defineAction<typeof repoGitRemoteChangeInput, { change: (input: z.output<typeof repoGitRemoteChangeInput>) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitRemoteChangeInput,
  http: { method: "POST", path: "/api/repos/[name]/git/remotes" },
  mcp: { reason: "Changing Git remotes is currently available only in the dashboard." },
  handler: (input, context) => context.change(input),
});

export const repoGitCommitActionInput = z.object({
  repo: z.string(),
  action: z.enum(["cherry-pick", "revert", "tag", "checkout-detached", "reset-to-commit", "branch-from-commit"]),
  commit: z.string().min(1).max(128),
  name: z.string().min(1).max(255).optional(),
});
export const repoGitCommitAction = defineAction<typeof repoGitCommitActionInput, { apply: (input: z.output<typeof repoGitCommitActionInput>) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitCommitActionInput,
  http: { method: "POST", path: "/api/repos/[name]/git/commit-action" },
  mcp: { reason: "The interactive commit actions are available only in the dashboard." },
  handler: (input, context) => context.apply(input),
});

export const repoGitInteractiveRebaseInput = z.object({
  repo: z.string(),
  base: z.string().min(7).max(40),
  steps: z.array(z.object({
    commit: z.string().min(7).max(40),
    op: z.enum(["pick", "reword", "fixup", "squash", "drop"]),
    message: z.string().max(4000).optional(),
  })).min(1).max(200),
});
export const repoGitInteractiveRebase = defineAction<typeof repoGitInteractiveRebaseInput, { rebase: (input: z.output<typeof repoGitInteractiveRebaseInput>) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitInteractiveRebaseInput,
  http: { method: "POST", path: "/api/repos/[name]/git/rebase-interactive" },
  mcp: { reason: "The interactive rebase planner is available only in the dashboard." },
  handler: (input, context) => context.rebase(input),
});

export const repoPrRemoteInput = z.object({
  fullName: z.string().max(201).regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
  // eslint-disable-next-line no-control-regex -- branch names must not contain control characters
  branch: z.string().min(1).max(255).refine((branch) => !branch.startsWith("-") && !/[\x00-\x1f\x7f]/.test(branch)),
});
export const repoPrRemote = defineAction<typeof repoPrRemoteInput, { read: (fullName: string, branch: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoPrRemoteInput,
  http: { method: "GET", path: "/api/repos/[name]/pr", discriminator: "query scope is remote" },
  mcp: { reason: "Remote branch PR lookup is an authenticated dashboard-internal operation." },
  handler: ({ fullName, branch }, context) => context.read(fullName, branch),
});

export const repoPrLocalInput = repoOpenInput;
export const repoPrLocal = defineAction<typeof repoPrLocalInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoPrLocalInput,
  http: { method: "GET", path: "/api/repos/[name]/pr", discriminator: "query scope is local" },
  mcp: { reason: "Local branch and default-branch details are a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoPrCurrentInput = repoOpenInput;
export const repoPrCurrent = defineAction<typeof repoPrCurrentInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoPrCurrentInput,
  http: { method: "GET", path: "/api/repos/[name]/pr", discriminator: "query scope is neither remote nor local" },
  mcp: { reason: "The repository card's current-branch PR is a dashboard-specific view." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitCommitMessageInput = repoOpenInput.extend({ stagedOnly: z.boolean() });
export const repoGitCommitMessage = defineAction<typeof repoGitCommitMessageInput, { suggest: (name: string, stagedOnly: boolean) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoGitCommitMessageInput,
  http: { method: "POST", path: "/api/repos/[name]/git/commit-message" },
  mcp: { reason: "AI commit-message suggestions are an interactive dashboard operation." },
  handler: ({ name, stagedOnly }, context) => context.suggest(name, stagedOnly),
});

export const repoGitStashMessageInput = repoOpenInput;
export const repoGitStashMessage = defineAction<typeof repoGitStashMessageInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoGitStashMessageInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stash-message" },
  mcp: { reason: "AI stash-message suggestions are an interactive dashboard operation." },
  handler: ({ name }, context) => context.read(name),
});

export const repoGitCouplingInput = repoOpenInput.extend({ paths: z.string() });
export const repoGitCoupling = defineAction<typeof repoGitCouplingInput, { read: (name: string, paths: string) => Promise<RepoGitHttpResponse> }, RepoGitHttpResponse>({
  input: repoGitCouplingInput,
  http: { method: "GET", path: "/api/repos/[name]/git/coupling" },
  mcp: { reason: "Change-coupling suggestions are a dashboard-specific Git view." },
  handler: ({ name, paths }, context) => context.read(name, paths),
});

export const repoGitCommitContextInput = repoOpenInput.extend({ commit: z.string() });
export const repoGitCommitContext = defineAction<typeof repoGitCommitContextInput, { read: (name: string, commit: string) => Promise<RepoGitHttpResponse> }, RepoGitHttpResponse>({
  input: repoGitCommitContextInput,
  http: { method: "GET", path: "/api/repos/[name]/git/commit-context" },
  mcp: { reason: "Commit context combines local review notes for the dashboard." },
  handler: ({ name, commit }, context) => context.read(name, commit),
});

export const repoComposeUpInput = repoOpenInput;
export const repoComposeUp = defineAction<typeof repoComposeUpInput, { run: (name: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoComposeUpInput,
  http: { method: "POST", path: "/api/repos/[name]/compose-up" },
  mcp: { reason: "Starting a local Docker Compose stack is an interactive dashboard operation." },
  handler: ({ name }, context) => context.run(name),
});

export const repoOpenGitkrakenInput = repoOpenInput;
export const repoOpenGitkraken = defineAction<typeof repoOpenGitkrakenInput, { open: (name: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoOpenGitkrakenInput,
  http: { method: "POST", path: "/api/repos/[name]/open-gitkraken" },
  mcp: { reason: "Opening a local GitKraken window is a dashboard operation." },
  handler: ({ name }, context) => context.open(name),
});

export const repoLearnStatusInput = repoOpenInput;
export const repoLearnStatus = defineAction<typeof repoLearnStatusInput, RepoDashboardReadContext, RepoGitResponse>({
  input: repoLearnStatusInput,
  http: { method: "GET", path: "/api/repos/[name]/learn/status" },
  mcp: { reason: "Learning-cache readiness is a dashboard-specific polling view." },
  handler: ({ name }, context) => context.read(name),
});

export type RepoLearnPackResult =
  | { ok: false; status: number; body: unknown }
  | { ok: true; bytes: Uint8Array; filename: string };

export const repoLearnPackInput = repoOpenInput;
export const repoLearnPack = defineAction<typeof repoLearnPackInput, { load: (name: string) => Promise<RepoLearnPackResult> }, RepoLearnPackResult>({
  input: repoLearnPackInput,
  http: { method: "GET", path: "/api/repos/[name]/learn/pack.zip" },
  mcp: { reason: "The binary NotebookLM download is a dashboard-only transport." },
  handler: ({ name }, context) => context.load(name),
});

export interface RepoLearnTutorStream {
  body: ReadableStream<Uint8Array> | null;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export const repoLearnTutorInput = repoOpenInput.extend({ messages: z.unknown() });
export const repoLearnTutor = defineAction<typeof repoLearnTutorInput, { stream: (name: string, messages: unknown) => Promise<RepoLearnTutorStream> }, RepoLearnTutorStream>({
  input: repoLearnTutorInput,
  http: { method: "POST", path: "/api/repos/[name]/learn/tutor" },
  mcp: { reason: "The interactive tutor uses a dashboard-only streaming transport." },
  handler: ({ name, messages }, context) => context.stream(name, messages),
});

export const repoWorkInput = repoOpenInput.extend({ scope: z.string().nullable() });
export const repoWork = defineAction<typeof repoWorkInput, { read: (name: string, scope: string | null) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoWorkInput,
  http: { method: "GET", path: "/api/repos/[name]/work" },
  mcp: { reason: "The aggregated repository work hub is a dashboard-specific view." },
  handler: ({ name, scope }, context) => context.read(name, scope),
});

export const repoCursorDraftInput = z.object({
  path: z.string().describe("Notes-relative source path"),
  repoName: z.string().describe("Repo used when opening the working copy"),
}).meta({ additionalProperties: false });
export const repoCursorDraftBodyInput = z.object({ notePath: repoCursorDraftInput.shape.path.min(1) });

export const repoCursorDraftStatusInput = repoCursorDraftInput;
export const repoCursorDraftStatus = defineAction<typeof repoCursorDraftStatusInput, { read: (repoName: string, path: string) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: repoCursorDraftStatusInput,
  http: { method: "GET", path: "/api/repos/[name]/open" },
  mcp: { reason: "Cursor draft readiness is a dashboard-specific view." },
  handler: ({ repoName, path }, context) => context.read(repoName, path),
});

export const repoCursorDraftApplyInput = repoCursorDraftInput;
export const repoCursorDraftApply = defineAction<typeof repoCursorDraftApplyInput, { apply: (repoName: string, path: string) => Promise<RepoGitResponse> }, { path: string; response: RepoGitResponse }>({
  input: repoCursorDraftApplyInput,
  http: { method: "PATCH", path: "/api/repos/[name]/open" },
  mcp: {
    name: "notes_cursor_apply",
    toolset: "notes",
    description: "Apply a persistent Cursor Markdown working copy back to its DevHub note. Refuses stale or structurally unsafe writes.",
  },
  handler: async ({ repoName, path }, context) => ({ path, response: await context.apply(repoName, path) }),
});

export const repoCursorDraftDeleteInput = repoCursorDraftInput;
export const repoCursorDraftDelete = defineAction<typeof repoCursorDraftDeleteInput, { remove: (repoName: string, path: string) => Promise<RepoGitResponse> }, { path: string; response: RepoGitResponse }>({
  input: repoCursorDraftDeleteInput,
  http: { method: "DELETE", path: "/api/repos/[name]/open" },
  mcp: {
    name: "notes_cursor_delete",
    toolset: "notes",
    description: "Delete a persistent Cursor Markdown working copy without changing the DevHub source note.",
  },
  handler: async ({ repoName, path }, context) => ({ path, response: await context.remove(repoName, path) }),
});

export const repoCursorOpenInput = z.object({
  path: z.string().describe("Notes-relative path, with or without .json"),
  repoName: z.string().describe("Local repo name as shown by repos_list"),
  worktree: z.string().optional().describe("Open one of the repo's worktrees instead of the main checkout, by absolute path or branch. Pass this when the work under review lives in an agent-run worktree, otherwise Cursor shows the note beside the wrong code."),
}).meta({ additionalProperties: false });
export const repoCursorOpen = defineAction<typeof repoCursorOpenInput, { open: (input: z.output<typeof repoCursorOpenInput>) => Promise<RepoGitResponse> }, { path: string; response: RepoGitResponse }>({
  input: repoCursorOpenInput,
  http: { method: "POST", path: "/api/repos/[name]/open", discriminator: "body has notePath" },
  mcp: {
    name: "notes_cursor_open",
    toolset: "notes",
    description: "Open a Cursor working copy of a note beside a local repo. Use notes_cursor_apply to write safe Markdown edits back to the note.",
  },
  handler: async (input, context) => ({ path: input.path, response: await context.open(input) }),
});

export const repoOpenBodyInput = z.object({
  notePath: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  worktree: z.string().min(1).max(4096).optional(),
}).refine((body) => !(body.notePath && body.filePath), {
  message: "Pass notePath or filePath, not both",
});

export const repoOpenOptionsInput = repoOpenBodyInput.safeExtend({
  name: repoOpenInput.shape.name,
}).meta({ additionalProperties: false });

export interface RepoOpenContext {
  open: (name: string) => Promise<RepoGitResponse>;
}

export interface RepoOpenOptionsContext {
  open: (input: z.output<typeof repoOpenOptionsInput>) => Promise<RepoGitResponse>;
}

export interface RepoOpenResult {
  name: string;
  response: RepoGitResponse;
}

export const repoOpen = defineAction<typeof repoOpenInput, RepoOpenContext, RepoOpenResult>({
  input: repoOpenInput,
  http: { method: "POST", path: "/api/repos/[name]/open", discriminator: "body is empty" },
  mcp: {
    name: "repos_open",
    toolset: "repos",
    description: "Open a tracked repo in the editor (Cursor) on this machine as-is (current branch, no checkout). To stash dirty work, check out a PR branch, then launch Cursor, use prs_open_in_cursor. Requires the dashboard running.",
  },
  handler: async ({ name }, context) => ({ name, response: await context.open(name) }),
});

export const repoOpenOptions = defineAction<typeof repoOpenOptionsInput, RepoOpenOptionsContext, RepoGitResponse>({
  input: repoOpenOptionsInput,
  http: { method: "POST", path: "/api/repos/[name]/open", discriminator: "body is nonempty without notePath" },
  mcp: { reason: "Opening notes, files, revisions or worktrees has separate HTTP-only controls." },
  handler: (input, context) => context.open(input),
});

export const repoGitStatusInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
}).meta({ additionalProperties: false });

export interface RepoGitStatusFile {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  status: string;
}

export interface RepoGitStatusData {
  currentBranch: string;
  upstream: string | null;
  files: RepoGitStatusFile[];
  staged: RepoGitStatusFile[];
  unstaged: RepoGitStatusFile[];
  untracked: RepoGitStatusFile[];
  conflictCount: number;
  contentSyncCount: number;
  clean: boolean;
}

export type RepoGitStatusResult =
  | { ok: true; data: RepoGitStatusData }
  | { ok: false; error: string };

export interface RepoGitStatusContext {
  getStatus: (name: string) => Promise<RepoGitStatusResult>;
}

export const repoGitStatus = defineAction<typeof repoGitStatusInput, RepoGitStatusContext, RepoGitStatusResult>({
  input: repoGitStatusInput,
  http: { method: "GET", path: "/api/repos/[name]/git/status" },
  mcp: {
    name: "repos_git_status",
    toolset: "repos",
    description: "Detailed git status for a tracked repo: branch, staged/unstaged/untracked files, conflicts. Uses the same API as the Git workspace. Requires the dashboard running.",
  },
  handler: ({ name }, context) => context.getStatus(name),
});

export const repoGitStageInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  action: z.enum(["stage", "unstage"]).describe("stage or unstage"),
  paths: z.array(z.string()).optional().describe("Repo-relative paths; omit to affect all"),
  confirm: z.boolean().describe("Must be true to execute"),
}).meta({ additionalProperties: false });

export interface RepoGitResponse {
  status: number;
  body: unknown;
}

export interface RepoGitHttpResponse extends RepoGitResponse {
  headers: Record<string, string>;
}

export type RepoGitMutationResponse = RepoGitResponse;

export const repoRevealInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
}).meta({ additionalProperties: false });

export interface RepoRevealContext {
  reveal: (name: string) => Promise<RepoGitResponse>;
}

export interface RepoRevealResult {
  name: string;
  response: RepoGitResponse;
}

export const repoReveal = defineAction<typeof repoRevealInput, RepoRevealContext, RepoRevealResult>({
  input: repoRevealInput,
  http: { method: "POST", path: "/api/repos/[name]/reveal" },
  mcp: {
    name: "repos_reveal",
    toolset: "repos",
    description: "Reveal a tracked repo folder in Finder / file manager. Requires the dashboard running.",
  },
  handler: async ({ name }, context) => ({ name, response: await context.reveal(name) }),
});

export const repoLearnInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  refresh: z.boolean().optional().describe("Force a rebuild instead of using the cached pack"),
}).meta({ additionalProperties: false });

export interface RepoLearnContext {
  learn: (input: z.output<typeof repoLearnInput>) => Promise<RepoGitResponse>;
}

export const repoLearn = defineAction<typeof repoLearnInput, RepoLearnContext, RepoGitResponse>({
  input: repoLearnInput,
  http: { method: "GET", path: "/api/repos/[name]/learn", discriminator: "query contains only refresh" },
  mcp: {
    name: "repo_learn",
    toolset: "repos",
    description: "Build (or fetch the cached) 'learn' context pack for a repo — an architecture/onboarding summary. Requires the dashboard running. May take up to a minute when refreshing.",
  },
  handler: (input, context) => context.learn(input),
});

export const repoGitBranchesInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
}).meta({ additionalProperties: false });

export interface RepoGitBranchesContext {
  listBranches: (name: string) => Promise<RepoGitResponse>;
}

export const repoGitBranches = defineAction<typeof repoGitBranchesInput, RepoGitBranchesContext, RepoGitResponse>({
  input: repoGitBranchesInput,
  http: { method: "GET", path: "/api/repos/[name]/branches" },
  mcp: {
    name: "repos_git_branches",
    toolset: "repos",
    description: "List branches + dirty/unpushed summary for a tracked repo (GET /branches). Requires the dashboard.",
  },
  handler: ({ name }, context) => context.listBranches(name),
});

export const repoGitStashInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  action: z.enum(["list", "show", "save", "apply", "pop", "drop"]),
  ref: z.string().optional().describe("stash@{n} or n (default stash@{0})"),
  message: z.string().optional().describe("Message for save"),
  confirm: z.boolean().optional().describe("Required true for save/apply/pop/drop"),
}).meta({ additionalProperties: false });

export type RepoGitStashResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; action: z.output<typeof repoGitStashInput>["action"]; response: RepoGitResponse };

export interface RepoGitStashContext {
  stash: (input: z.output<typeof repoGitStashInput>) => Promise<RepoGitResponse>;
}

async function executeRepoGitStash(input: z.output<typeof repoGitStashInput>, context: RepoGitStashContext): Promise<RepoGitStashResult> {
  if (input.action !== "list" && input.action !== "show" && !input.confirm) {
    return { kind: "preview", message: `Dry run — would ${input.action} stash${input.ref ? ` ${input.ref}` : ""}. Pass confirm:true.` };
  }
  return { kind: "executed", action: input.action, response: await context.stash(input) };
}

export const repoGitStash = defineAction<typeof repoGitStashInput, RepoGitStashContext, RepoGitStashResult>({
  input: repoGitStashInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stash" },
  mcp: {
    name: "repos_git_stash",
    toolset: "repos",
    description: "Stash browser: list (action=list), show, save, apply, pop, or drop. Mutating actions require confirm:true.",
  },
  handler: executeRepoGitStash,
});

export const repoGitStashList = defineAction<typeof repoGitStashInput, RepoGitStashContext, RepoGitStashResult>({
  input: repoGitStashInput,
  http: { method: "GET", path: "/api/repos/[name]/git/stash" },
  mcp: { reason: "The repos_git_stash tool already includes listing." },
  handler: executeRepoGitStash,
});

export const repoGitConflictsInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  action: z.enum(["list", "resolve"]).optional().describe("Default list"),
  path: z.string().optional().describe("File path for resolve"),
  content: z.string().optional().describe("Resolved file contents for resolve"),
  expectedContent: z.string().nullable().optional().describe("Original conflict content from list; required for resolve"),
  confirm: z.boolean().optional().describe("Required true for resolve"),
}).meta({ additionalProperties: false });

export type RepoGitConflictsResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; action: "list" | "resolve"; response: RepoGitResponse };

export interface RepoGitConflictsContext {
  conflicts: (input: z.output<typeof repoGitConflictsInput>) => Promise<RepoGitResponse>;
}

async function executeRepoGitConflicts(input: z.output<typeof repoGitConflictsInput>, context: RepoGitConflictsContext): Promise<RepoGitConflictsResult> {
  const action = input.action ?? "list";
  if (action === "resolve" && !input.confirm) {
    return { kind: "preview", message: `Dry run — would resolve ${input.path ?? "(missing path)"}. Pass confirm:true.` };
  }
  return { kind: "executed", action, response: await context.conflicts(input) };
}

export const repoGitConflicts = defineAction<typeof repoGitConflictsInput, RepoGitConflictsContext, RepoGitConflictsResult>({
  input: repoGitConflictsInput,
  http: { method: "POST", path: "/api/repos/[name]/git/conflicts" },
  mcp: {
    name: "repos_git_conflicts",
    toolset: "repos",
    description: "List conflicted files, or resolve one using the original expectedContent from list. Resolve requires confirm:true.",
  },
  handler: executeRepoGitConflicts,
});

export const repoGitConflictsList = defineAction<typeof repoGitConflictsInput, RepoGitConflictsContext, RepoGitConflictsResult>({
  input: repoGitConflictsInput,
  http: { method: "GET", path: "/api/repos/[name]/git/conflicts" },
  mcp: { reason: "The repos_git_conflicts tool already includes listing." },
  handler: executeRepoGitConflicts,
});

export const repoGitWorktreesInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  action: z.enum(["list", "review", "cleanup", "add", "remove", "prune", "lock", "unlock"]).optional().describe("Default list"),
  branch: z.string().optional().describe("Branch for add"),
  path: z.string().optional().describe("Worktree directory (target for add; required for remove/lock/unlock)"),
  createBranch: z.boolean().optional().describe("add: create branch instead of checking out an existing one"),
  force: z.boolean().optional().describe("remove: discard the worktree's uncommitted changes"),
  entries: z.array(z.object({ path: z.string().min(1).max(4096), head: z.string().regex(/^[a-f0-9]{40,64}$/) })).min(1).max(50).optional().describe("cleanup: exact paths and HEADs returned by review"),
  confirm: z.boolean().optional().describe("cleanup: explicitly approve removing the reviewed checkouts"),
  includeIgnored: z.boolean().optional().describe("cleanup: approve deletion of the ignored files shown by review"),
}).meta({ additionalProperties: false });

export type RepoGitWorktreesAction = NonNullable<z.output<typeof repoGitWorktreesInput>["action"]>;
export type RepoGitWorktreesResult =
  | { kind: "rejected"; message: string }
  | { kind: "executed"; action: RepoGitWorktreesAction; response: RepoGitResponse };

export interface RepoGitWorktreesContext {
  worktrees: (input: z.output<typeof repoGitWorktreesInput>) => Promise<RepoGitResponse>;
}

async function executeRepoGitWorktrees(input: z.output<typeof repoGitWorktreesInput>, context: RepoGitWorktreesContext): Promise<RepoGitWorktreesResult> {
  const action = input.action ?? "list";
  if (action === "cleanup" && (input.confirm !== true || !input.entries?.length)) {
    return { kind: "rejected", message: "Run review first, then supply entries (path + head) and confirm:true. No worktrees removed." };
  }
  return { kind: "executed", action, response: await context.worktrees(input) };
}

export const repoGitWorktrees = defineAction<typeof repoGitWorktreesInput, RepoGitWorktreesContext, RepoGitWorktreesResult>({
  input: repoGitWorktreesInput,
  http: { method: "POST", path: "/api/repos/[name]/git/worktrees" },
  mcp: {
    name: "repos_git_worktrees",
    toolset: "repos",
    description: "List git worktrees, review merged cleanup, or add/remove/prune/lock/unlock. review returns GitHub merge evidence, equivalence to the current remote default branch (including rebased/squashed changes), local changes, ignored files, blockers and HEADs. Cleanup does not rebase or rewrite branches. cleanup removes only verified merged checkouts from reviewed entries (path + head), requires confirm:true, and rechecks safety; never forces. includeIgnored:true acknowledges deletion of the listed ignored local files. Branches and commits remain. prune only forgets missing folders. add creates a branch only with createBranch:true; remove refuses dirty worktrees unless force:true.",
  },
  handler: executeRepoGitWorktrees,
});

export const repoGitWorktreesList = defineAction<typeof repoGitWorktreesInput, RepoGitWorktreesContext, RepoGitWorktreesResult>({
  input: repoGitWorktreesInput,
  http: { method: "GET", path: "/api/repos/[name]/git/worktrees" },
  mcp: { reason: "The repos_git_worktrees tool already includes listing." },
  handler: executeRepoGitWorktrees,
});

export const repoGitWorktreesReview = defineAction<typeof repoGitWorktreesInput, RepoGitWorktreesContext, RepoGitWorktreesResult>({
  input: repoGitWorktreesInput,
  http: { method: "GET", path: "/api/repos/[name]/worktrees", discriminator: "query contains only details" },
  mcp: { reason: "The repos_git_worktrees tool already includes review." },
  handler: executeRepoGitWorktrees,
});

export const repoGitWorktreesCleanup = defineAction<typeof repoGitWorktreesInput, RepoGitWorktreesContext, RepoGitWorktreesResult>({
  input: repoGitWorktreesInput,
  http: { method: "POST", path: "/api/repos/[name]/worktrees" },
  mcp: { reason: "The repos_git_worktrees tool already includes verified cleanup." },
  handler: executeRepoGitWorktrees,
});

export const repoWorktreeCleanupInput = z.object({
  action: z.enum(["list", "remove"]).optional().describe("Default list"),
  items: z.array(z.object({ repo: z.string().min(1), path: z.string().min(1).max(4096) })).min(1).max(200).optional().describe("remove: worktrees from list (repo + path)"),
  all: z.boolean().optional().describe("remove: every worktree list currently shows, instead of items"),
  dryRun: z.boolean().optional().describe("remove: report what would be removed and skipped; change nothing"),
  confirm: z.boolean().optional().describe("remove: explicitly approve deleting the folders"),
}).meta({ additionalProperties: false });

export type RepoWorktreeCleanupItem = NonNullable<z.output<typeof repoWorktreeCleanupInput>["items"]>[number];
export type RepoWorktreeCleanupResult =
  | { kind: "rejected"; message: string }
  | { kind: "listed"; response: RepoGitResponse }
  | { kind: "removed"; dryRun: boolean; response: RepoGitResponse };

export interface RepoWorktreeCleanupContext {
  list: () => Promise<RepoGitResponse>;
  remove: (items: RepoWorktreeCleanupItem[], dryRun?: boolean) => Promise<RepoGitResponse>;
}

async function executeRepoWorktreeCleanup(input: z.output<typeof repoWorktreeCleanupInput>, context: RepoWorktreeCleanupContext): Promise<RepoWorktreeCleanupResult> {
  if ((input.action ?? "list") === "list") return { kind: "listed", response: await context.list() };
  let targets = input.items ?? [];
  if (input.all) {
    const response = await context.list();
    targets = (response.body as { rows: RepoWorktreeCleanupItem[] }).rows.map(({ repo, path }) => ({ repo, path }));
  }
  if (!targets.length) return { kind: "rejected", message: "Give items (repo + path from list) or all:true. No worktrees removed." };
  if (!input.dryRun && input.confirm !== true) {
    return { kind: "rejected", message: `Removing ${targets.length} worktree(s) needs confirm:true (try dryRun:true first). No worktrees removed.` };
  }
  return { kind: "removed", dryRun: Boolean(input.dryRun), response: await context.remove(targets, input.dryRun) };
}

export const repoWorktreeCleanup = defineAction<typeof repoWorktreeCleanupInput, RepoWorktreeCleanupContext, RepoWorktreeCleanupResult>({
  input: repoWorktreeCleanupInput,
  http: { method: "POST", path: "/api/repos/worktree-cleanup", discriminator: "body has items" },
  mcp: {
    name: "repos_worktree_cleanup",
    toolset: "repos",
    description: "Finished worktrees across every local repo (the PRs page Worktrees tab): list shows rows with a merged PR, a stopped agent run, or a missing folder. remove deletes many at once from items (repo + path from list); dryRun:true reports what would go and what would be skipped. remove needs confirm:true unless dryRun, never forces, and skips any worktree with uncommitted changes or an agent run still going, with the reason. Only checkout folders go; branches and commits stay.",
  },
  handler: executeRepoWorktreeCleanup,
});

export const repoWorktreeCleanupList = defineAction<typeof repoWorktreeCleanupInput, RepoWorktreeCleanupContext, RepoWorktreeCleanupResult>({
  input: repoWorktreeCleanupInput,
  http: { method: "GET", path: "/api/repos/worktree-cleanup" },
  mcp: { reason: "The repos_worktree_cleanup tool already includes listing." },
  handler: executeRepoWorktreeCleanup,
});

export const repoWorktreeSingleRemoveInput = z.object({
  repo: z.string().min(1),
  path: z.string().min(1).max(4096),
  force: z.boolean().optional(),
}).meta({ additionalProperties: false });

export interface RepoWorktreeSingleRemoveContext {
  removeSingle: (input: z.output<typeof repoWorktreeSingleRemoveInput>) => Promise<RepoGitResponse>;
}

export const repoWorktreeSingleRemove = defineAction<typeof repoWorktreeSingleRemoveInput, RepoWorktreeSingleRemoveContext, RepoGitResponse>({
  input: repoWorktreeSingleRemoveInput,
  http: { method: "POST", path: "/api/repos/worktree-cleanup", discriminator: "body has no items" },
  mcp: { reason: "The agent tool only exposes non-forced bulk cleanup; single forced removal remains dashboard-only." },
  handler: (input, context) => context.removeSingle(input),
});

export type RepoGitStageResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; action: "stage" | "unstage"; response: RepoGitMutationResponse };

export interface RepoGitStageContext {
  stage: (input: z.output<typeof repoGitStageInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitStage = defineAction<typeof repoGitStageInput, RepoGitStageContext, RepoGitStageResult>({
  input: repoGitStageInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stage", discriminator: "body action is stage or unstage" },
  mcp: {
    name: "repos_git_stage",
    toolset: "repos",
    description: "Stage or unstage paths in a tracked repo (empty paths = stage/unstage all). Requires confirm:true. Proxies /git/stage.",
  },
  handler: async (input, context) => {
    if (!input.confirm) {
      return { kind: "preview", message: `Dry run — would ${input.action} ${input.paths?.length ? input.paths.join(", ") : "all files"}. Pass confirm:true.` };
    }
    return { kind: "executed", action: input.action, response: await context.stage(input) };
  },
});

export const repoGitDiscardInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  paths: z.array(z.string()).min(1).describe("Repo-relative paths to discard"),
  scope: z.enum(["staged", "unstaged"]).describe("staged = discard staged changes while preserving non-overlapping unstaged edits; unstaged = discard worktree changes only"),
  confirm: z.boolean().describe("Must be true to execute (destructive)"),
}).meta({ additionalProperties: false });

export type RepoGitDiscardResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; response: RepoGitMutationResponse };

export interface RepoGitDiscardContext {
  discard: (input: z.output<typeof repoGitDiscardInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitDiscard = defineAction<typeof repoGitDiscardInput, RepoGitDiscardContext, RepoGitDiscardResult>({
  input: repoGitDiscardInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stage", discriminator: "body action is discard and paths are present" },
  mcp: {
    name: "repos_git_discard",
    toolset: "repos",
    description: "Discard staged changes while preserving non-overlapping unstaged edits, or discard unstaged changes while keeping the index. Conflicting or unsupported staged discards are refused. Requires confirm:true.",
  },
  handler: async (input, context) => {
    if (!input.confirm) {
      return { kind: "preview", message: `Dry run — would discard ${input.scope} changes in ${input.paths.join(", ")}. Pass confirm:true.` };
    }
    return { kind: "executed", response: await context.discard(input) };
  },
});

export const repoGitStageHunkInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  path: z.string().describe("Repo-relative file path"),
  action: z.enum(["stage-hunk", "unstage-hunk"]),
  rawDiff: z.string().describe("Unified diff text containing the hunk"),
  hunkIndex: z.number().int().min(0).describe("0-based hunk index within the file diff"),
  lineIndexes: z.array(z.number().int().positive()).optional().describe("Optional 1-based patch body line indexes within the hunk"),
  confirm: z.boolean().describe("Must be true to execute"),
}).meta({ additionalProperties: false });

export type RepoGitStageHunkResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; action: "stage-hunk" | "unstage-hunk"; response: RepoGitMutationResponse };

export interface RepoGitStageHunkContext {
  stageHunk: (input: z.output<typeof repoGitStageHunkInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitStageHunk = defineAction<typeof repoGitStageHunkInput, RepoGitStageHunkContext, RepoGitStageHunkResult>({
  input: repoGitStageHunkInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stage", discriminator: "body action is stage-hunk or unstage-hunk and matches MCP hunk input" },
  mcp: {
    name: "repos_git_stage_hunk",
    toolset: "repos",
    description: "Stage or unstage a specific hunk (or selected lines) from a unified diff. Requires confirm:true. Pass rawDiff from repos_git_diff / the UI.",
  },
  handler: async (input, context) => {
    if (!input.confirm) {
      return { kind: "preview", message: `Dry run — would ${input.action} hunk ${input.hunkIndex} on ${input.path}. Pass confirm:true.` };
    }
    return { kind: "executed", action: input.action, response: await context.stageHunk(input) };
  },
});

export const repoGitDashboardStageHunkInput = repoGitStageHunkInput.omit({ confirm: true }).extend({
  hunkIndex: z.number().min(0),
  lineIndexes: z.array(z.number().positive()).optional(),
});
export const repoGitDashboardStageHunk = defineAction<typeof repoGitDashboardStageHunkInput, { stageHunk: () => Promise<RepoGitMutationResponse> }, RepoGitMutationResponse>({
  input: repoGitDashboardStageHunkInput,
  http: { method: "POST", path: "/api/repos/[name]/git/stage", discriminator: "body action is stage-hunk or unstage-hunk and matches dashboard hunk input after MCP check" },
  mcp: { reason: "The dashboard preserves its existing numeric hunk and line selection inputs." },
  handler: (_input, context) => context.stageHunk(),
});

export const repoGitBranchInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  action: z.enum(["checkout", "create-branch", "delete-branch", "fetch", "pull", "push", "undo-commit"]),
  branch: z.string().optional().describe("Branch name for checkout/create/delete"),
  confirm: z.boolean().describe("Must be true to execute"),
}).meta({ additionalProperties: false });

export type RepoGitBranchResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; action: z.output<typeof repoGitBranchInput>["action"]; response: RepoGitMutationResponse };

export interface RepoGitBranchContext {
  branch: (input: z.output<typeof repoGitBranchInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitBranch = defineAction<typeof repoGitBranchInput, RepoGitBranchContext, RepoGitBranchResult>({
  input: repoGitBranchInput,
  http: { method: "POST", path: "/api/repos/[name]/branches", discriminator: "body matches branch input with only action and branch" },
  mcp: {
    name: "repos_git_branch",
    toolset: "repos",
    description: "Branch/network actions via /branches: checkout, create-branch, delete-branch, fetch, pull, push, undo-commit. Mutating actions require confirm:true.",
  },
  handler: async (input, context) => {
    if (!input.confirm) {
      return { kind: "preview", message: `Dry run — would ${input.action}${input.branch ? ` ${input.branch}` : ""}. Pass confirm:true.` };
    }
    return { kind: "executed", action: input.action, response: await context.branch(input) };
  },
});

export const repoGitCommitInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  message: z.string().describe("Commit message (conventional commits preferred)"),
  amend: z.boolean().optional().describe("Amend HEAD when appropriate"),
  confirm: z.boolean().describe("Must be true to execute"),
}).meta({ additionalProperties: false });

export type RepoGitCommitResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; amend: boolean; response: RepoGitMutationResponse };

export interface RepoGitCommitContext {
  commit: (input: z.output<typeof repoGitCommitInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitCommit = defineAction<typeof repoGitCommitInput, RepoGitCommitContext, RepoGitCommitResult>({
  input: repoGitCommitInput,
  http: { method: "POST", path: "/api/repos/[name]/branches", discriminator: "body matches commit input with only action, message and amend" },
  mcp: {
    name: "repos_git_commit",
    toolset: "repos",
    description: "Commit staged changes (or amend) via the Git workspace branches API. Does not auto-stage unless you stage first. Requires confirm:true.",
  },
  handler: async (input, context) => {
    if (!input.confirm) {
      return { kind: "preview", message: `Dry run — would ${input.amend ? "amend" : "commit"} with message: ${input.message}` };
    }
    return { kind: "executed", amend: Boolean(input.amend), response: await context.commit(input) };
  },
});

export const repoGitPushInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  confirm: z.boolean().describe("Must be true to execute"),
}).meta({ additionalProperties: false });

export type RepoGitPushResult =
  | { kind: "preview"; message: string }
  | { kind: "executed"; response: RepoGitMutationResponse };

export interface RepoGitPushContext {
  push: (input: z.output<typeof repoGitPushInput>) => Promise<RepoGitMutationResponse>;
}

export const repoGitPush = defineAction<typeof repoGitPushInput, RepoGitPushContext, RepoGitPushResult>({
  input: repoGitPushInput,
  http: { reason: "This MCP alias uses the existing repoGitBranch push operation." },
  mcp: {
    name: "repos_git_push",
    toolset: "repos",
    description: "Push the current branch to origin via the Git workspace API (hooks + timeout). Requires confirm:true.",
  },
  handler: async (input, context) => {
    if (!input.confirm) return { kind: "preview", message: "Dry run — pass confirm:true to push." };
    return { kind: "executed", response: await context.push(input) };
  },
});

export const repoGitLogInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  limit: z.number().int().min(5).max(100).optional().describe("Max commits (default 40)"),
  offset: z.number().int().min(0).optional().describe("Commits to skip for pagination"),
  scope: z.enum(["all", "current"]).optional().describe("all branches (default) or current branch only"),
  query: z.string().trim().min(1).max(200).optional().describe("Search commit messages, or a SHA"),
}).meta({ additionalProperties: false });

export interface RepoGitLogContext {
  log: (input: z.output<typeof repoGitLogInput>) => Promise<RepoGitResponse>;
}

export const repoGitLog = defineAction<typeof repoGitLogInput, RepoGitLogContext, RepoGitResponse>({
  input: repoGitLogInput,
  http: { method: "GET", path: "/api/repos/[name]/git/log", discriminator: "query has only limit, offset, scope and q and matches MCP log input" },
  mcp: {
    name: "repos_git_log",
    toolset: "repos",
    description: "Commit history for a tracked repo, one line per commit (hash, age, author, subject, refs). scope=current follows HEAD only, like `git log`; the default covers every branch, like the History graph. query searches commit messages (or resolves a SHA).",
  },
  handler: (input, context) => context.log(input),
});

export const repoGitShowInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  ref: z.string().describe("Commit SHA or HEAD~n"),
  path: z.string().optional().describe("Optional file path within the commit"),
}).meta({ additionalProperties: false });

export interface RepoGitShowContext {
  show: (input: z.output<typeof repoGitShowInput>) => Promise<RepoGitResponse>;
}

export const repoGitShow = defineAction<typeof repoGitShowInput, RepoGitShowContext, RepoGitResponse>({
  input: repoGitShowInput,
  http: { method: "GET", path: "/api/repos/[name]/git/show", discriminator: "query contains only commit, ref, hash or path" },
  mcp: {
    name: "repos_git_show",
    toolset: "repos",
    description: "Show a commit: header, message, changed files, and the patch for one file (path, else the first changed file).",
  },
  handler: (input, context) => context.show(input),
});

export const repoGitBlameInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  path: z.string().describe("Repo-relative file path"),
  startLine: z.number().int().min(1).optional().describe("First line to include (1-based)"),
  endLine: z.number().int().min(1).optional().describe("Last line to include"),
  line: z.number().int().min(1).optional().describe("Scope the history to commits touching this line"),
}).meta({ additionalProperties: false });

export interface RepoGitBlameContext {
  blame: (input: z.output<typeof repoGitBlameInput>) => Promise<RepoGitResponse>;
}

export interface RepoGitBlameResult {
  response: RepoGitResponse;
  startLine?: number;
  endLine?: number;
}

export const repoGitBlame = defineAction<typeof repoGitBlameInput, RepoGitBlameContext, RepoGitBlameResult>({
  input: repoGitBlameInput,
  http: { method: "GET", path: "/api/repos/[name]/git/blame", discriminator: "query has only path and line and matches MCP blame input" },
  mcp: {
    name: "repos_git_blame",
    toolset: "repos",
    description: "Blame a file (commit, author, date per line) plus its recent history. Pass startLine/endLine for a range; pass line to scope the history to commits that touched that line.",
  },
  handler: async (input, context) => ({ response: await context.blame(input), startLine: input.startLine, endLine: input.endLine }),
});

export const repoGitDiffInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  path: z.string().optional().describe("Repo-relative file path; omit for full diff"),
  staged: z.boolean().optional().describe("true = staged (cached) diff"),
  context: z.number().int().min(0).max(200).optional().describe("Context lines around each hunk (default 3)"),
}).meta({ additionalProperties: false });

export interface RepoGitDiffContext {
  diff: (input: z.output<typeof repoGitDiffInput>) => Promise<RepoGitResponse>;
}

export interface RepoGitDiffResult {
  response: RepoGitResponse;
  path?: string;
}

export const repoGitDiff = defineAction<typeof repoGitDiffInput, RepoGitDiffContext, RepoGitDiffResult>({
  input: repoGitDiffInput,
  http: { method: "GET", path: "/api/repos/[name]/git/diff", discriminator: "query has only path, staged and context and matches MCP diff input" },
  mcp: {
    name: "repos_git_diff",
    toolset: "repos",
    description: "Unified diff of uncommitted changes for one file (or the whole working tree). staged=true for the cached diff. Whole-tree diffs are truncated past 60k chars — call repos_git_status first and pass path for the files you need. For a branch vs main, use repos_git_range.",
  },
  handler: async (input, context) => ({ response: await context.diff(input), path: input.path }),
});

export const repoGitRangeInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  base: z.string().optional().describe("Base branch, tag or SHA — no ~/^ suffixes (default: the repo's trunk, e.g. origin/main)"),
  head: z.string().optional().describe("Head branch, tag or SHA (default HEAD)"),
  path: z.string().optional().describe("Limit the patch to one repo-relative path"),
  filesOnly: z.boolean().optional().describe("Only list changed files and counts, no patch"),
  context: z.number().int().min(0).max(200).optional().describe("Context lines around each hunk (default 3)"),
}).meta({ additionalProperties: false });

export interface RepoGitRangeContext {
  range: (input: z.output<typeof repoGitRangeInput>) => Promise<RepoGitResponse>;
}

export interface RepoGitRangeResult {
  response: RepoGitResponse;
  filesOnly?: boolean;
}

export const repoGitRange = defineAction<typeof repoGitRangeInput, RepoGitRangeContext, RepoGitRangeResult>({
  input: repoGitRangeInput,
  http: { method: "GET", path: "/api/repos/[name]/git/range", discriminator: "query has only base, head, path and context and matches MCP range input" },
  mcp: {
    name: "repos_git_range",
    toolset: "repos",
    description: "What a branch changes vs its base — the review-shaped diff. Merge-base range (base...head), so it shows what head added, not what it is missing. Returns ahead/behind, the changed files, and the patch (truncated past 60k chars; pass path or filesOnly). Defaults: base = the repo's trunk, head = HEAD.",
  },
  handler: async (input, context) => ({ response: await context.range(input), filesOnly: input.filesOnly }),
});

export const repoGitCiInput = z.object({
  name: z.string().describe("Repo name as shown by repos_list"),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/, "commit must be a hex SHA").optional().describe("Commit SHA to check instead of the branch PR"),
}).meta({ additionalProperties: false });

export interface RepoGitCiContext {
  ci: (input: z.output<typeof repoGitCiInput>) => Promise<RepoGitResponse>;
}

export interface RepoGitCiResult {
  commit?: string;
  response: RepoGitResponse;
}

async function readRepoGitCi(input: z.output<typeof repoGitCiInput>, context: RepoGitCiContext): Promise<RepoGitCiResult> {
  return { commit: input.commit, response: await context.ci(input) };
}

export const repoGitCi = defineAction<typeof repoGitCiInput, RepoGitCiContext, RepoGitCiResult>({
  input: repoGitCiInput,
  http: { method: "GET", path: "/api/repos/[name]/git/ci", discriminator: "query matches MCP CI input" },
  mcp: {
    name: "repos_git_ci",
    toolset: "repos",
    description: "CI state without leaving the repo: with no commit, the open PR for the current branch and its check rollup; with commit (hex SHA), that commit's check runs. To diagnose a failing check, follow up with prs_pipeline_investigate. Needs gh.",
  },
  handler: readRepoGitCi,
});

export const repoGitBranchPr = defineAction<typeof repoGitCiInput, RepoGitCiContext, RepoGitCiResult>({
  input: repoGitCiInput,
  http: { method: "GET", path: "/api/repos/[name]/git/branch-pr" },
  mcp: { reason: "The repos_git_ci tool already includes the current branch's PR checks." },
  handler: readRepoGitCi,
});

export const coreGitConflictsInput = z.object({}).meta({ additionalProperties: false });
export const coreGitConflicts = defineAction<typeof coreGitConflictsInput, { read: () => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: coreGitConflictsInput,
  http: { method: "GET", path: "/api/git/conflicts" },
  mcp: { reason: "This conflict view targets the DevHub checkout; MCP exposes tracked repository conflicts separately." },
  handler: (_input, context) => context.read(),
});

export const coreGitResolveConflictInput = z.object({ path: z.string().min(1), content: z.string(), expectedContent: z.string().nullable() }).meta({ additionalProperties: false });
export const coreGitResolveConflict = defineAction<typeof coreGitResolveConflictInput, { resolve: (input: z.output<typeof coreGitResolveConflictInput>) => Promise<RepoGitResponse> }, RepoGitResponse>({
  input: coreGitResolveConflictInput,
  http: { method: "POST", path: "/api/git/conflicts" },
  mcp: { reason: "This dashboard action resolves DevHub checkout conflicts; tracked-repository MCP writes require confirmation." },
  handler: (input, context) => context.resolve(input),
});
