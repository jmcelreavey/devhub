import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import {
  capText,
  formatGitBlame,
  formatGitBranches,
  formatGitDiff,
  formatGitLog,
  formatGitShow,
  formatGitStatus,
  type GitBlamePayload,
  type GitBranchesPayload,
  type GitDiffPayload,
  type GitLogPayload,
  type GitShowPayload,
  type GitStatusPayload,
} from "./git-format.ts";

interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  remote: string | null;
  dirtyCount: number;
  unpushedCount: number;
  hasCompose: boolean;
}

function repoPath(name: string, sub: string): string {
  return `/api/repos/${encodeURIComponent(name)}${sub}`;
}

function jsonText(data: unknown, fallback = "OK"): string {
  if (typeof data === "string") return data || fallback;
  // Compact: indentation alone was ~30% of these payloads.
  return JSON.stringify(data);
}

const nameSchema = z.string().describe("Repo name as shown by repos_list");

export function registerReposTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "repos_list",
    {
      description:
        "List the local repos DevHub tracks, with branch, dirty-file count, and unpushed-commit count. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ repos: RepoInfo[]; scanDirDisplay?: string }>("/api/repos");
        if (!data.repos?.length) {
          return {
            content: [
              {
                type: "text",
                text: `No repos found${data.scanDirDisplay ? ` under ${data.scanDirDisplay}` : ""}.`,
              },
            ],
          };
        }
        const lines = data.repos.map((r) => {
          const flags = [
            r.branch ?? "(detached)",
            r.dirtyCount ? `${r.dirtyCount} dirty` : null,
            r.unpushedCount ? `${r.unpushedCount} unpushed` : null,
            r.hasCompose ? "compose" : null,
          ]
            .filter(Boolean)
            .join(", ");
          return `- ${r.name} [${flags}]`;
        });
        return { content: [{ type: "text", text: `Repos (${data.repos.length}):\n${lines.join("\n")}` }] };
      }),
  );

  server.registerTool(
    "repos_open",
    {
      description:
        "Open a tracked repo in the editor (Cursor) on this machine as-is (current branch, no checkout). To stash dirty work, check out a PR branch, then launch Cursor, use prs_open_in_cursor. Requires the dashboard running.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; path: string }>(repoPath(name, "/open"), {});
        return { content: [{ type: "text", text: `Opened ${name} (${r.path}).` }] };
      }),
  );

  server.registerTool(
    "repos_reveal",
    {
      description: "Reveal a tracked repo folder in Finder / file manager. Requires the dashboard running.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; path: string; label?: string }>(
          repoPath(name, "/reveal"),
        );
        return {
          content: [
            {
              type: "text",
              text: `Revealed ${name}${r.path ? ` (${r.path})` : ""}${r.label ? ` in ${r.label}` : ""}.`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "repos_clone",
    {
      description:
        "Clone a GitHub repo into the DevHub repos directory. Requires the dashboard running and gh/git available.",
      inputSchema: {
        fullName: z.string().describe("GitHub owner/repo, e.g. acme/widgets"),
      },
    },
    async ({ fullName }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; repo?: { name?: string; path?: string } }>(
          "/api/repos/clone",
          { fullName },
          120_000,
        );
        return {
          content: [
            {
              type: "text",
              text: `Cloned ${fullName}${r.repo?.path ? ` → ${r.repo.path}` : ""}.`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "repo_learn",
    {
      description:
        "Build (or fetch the cached) 'learn' context pack for a repo — an architecture/onboarding summary. Requires the dashboard running. May take up to a minute when refreshing.",
      inputSchema: {
        name: nameSchema,
        refresh: z.boolean().optional().describe("Force a rebuild instead of using the cached pack"),
      },
    },
    async ({ name, refresh }) =>
      withDashboardErrors(async () => {
        const payload = await dashboard.get<Record<string, unknown>>(
          repoPath(name, "/learn"),
          { refresh: refresh ? "1" : undefined },
          70_000,
        );
        const summary =
          typeof payload.summary === "string"
            ? payload.summary
            : typeof payload.markdown === "string"
              ? payload.markdown
              : JSON.stringify(payload);
        return { content: [{ type: "text", text: summary }] };
      }),
  );

  // ── Git workspace (proxies /api/repos/:name/git/* + branches) ─────────────

  server.registerTool(
    "repos_git_status",
    {
      description:
        "Detailed git status for a tracked repo: branch, staged/unstaged/untracked files, conflicts. Uses the same API as the Git workspace. Requires the dashboard running.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitStatusPayload>(repoPath(name, "/git/status"));
        return { content: [{ type: "text", text: formatGitStatus(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_stage",
    {
      description:
        "Stage or unstage paths in a tracked repo (empty paths = stage/unstage all). Requires confirm:true. Proxies /git/stage.",
      inputSchema: {
        name: nameSchema,
        action: z.enum(["stage", "unstage"]).describe("stage or unstage"),
        paths: z.array(z.string()).optional().describe("Repo-relative paths; omit to affect all"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, action, paths, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would ${action} ${paths?.length ? paths.join(", ") : "all files"}. Pass confirm:true.`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/git/stage"), {
          action,
          paths: paths ?? [],
        });
        return { content: [{ type: "text", text: jsonText(data, `${action} OK`) }] };
      }),
  );

  server.registerTool(
    "repos_git_discard",
    {
      description:
        "Discard staged or unstaged changes for paths. scope=staged keeps unstaged hunks; scope=unstaged keeps staged. Requires confirm:true.",
      inputSchema: {
        name: nameSchema,
        paths: z.array(z.string()).min(1).describe("Repo-relative paths to discard"),
        scope: z
          .enum(["staged", "unstaged"])
          .describe("staged = discard index only (keep worktree); unstaged = discard worktree only"),
        confirm: z.boolean().describe("Must be true to execute (destructive)"),
      },
    },
    async ({ name, paths, scope, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would discard ${scope} changes in ${paths.join(", ")}. Pass confirm:true.`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/git/stage"), {
          action: "discard",
          paths,
          scope,
        });
        return { content: [{ type: "text", text: jsonText(data, "Discarded") }] };
      }),
  );

  server.registerTool(
    "repos_git_stage_hunk",
    {
      description:
        "Stage or unstage a specific hunk (or selected lines) from a unified diff. Requires confirm:true. Pass rawDiff from repos_git_diff / the UI.",
      inputSchema: {
        name: nameSchema,
        path: z.string().describe("Repo-relative file path"),
        action: z.enum(["stage-hunk", "unstage-hunk"]),
        rawDiff: z.string().describe("Unified diff text containing the hunk"),
        hunkIndex: z.number().int().min(0).describe("0-based hunk index within the file diff"),
        lineIndexes: z
          .array(z.number().int().positive())
          .optional()
          .describe("Optional 1-based patch body line indexes within the hunk"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, path: filePath, action, rawDiff, hunkIndex, lineIndexes, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would ${action} hunk ${hunkIndex} on ${filePath}. Pass confirm:true.`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/git/stage"), {
          action,
          path: filePath,
          rawDiff,
          hunkIndex,
          lineIndexes,
        });
        return { content: [{ type: "text", text: jsonText(data, `${action} OK`) }] };
      }),
  );

  server.registerTool(
    "repos_git_diff",
    {
      description:
        "Unified diff of uncommitted changes for one file (or the whole working tree). staged=true for the cached diff. Whole-tree diffs are truncated past 60k chars — call repos_git_status first and pass path for the files you need. For a branch vs main, use repos_git_range.",
      inputSchema: {
        name: nameSchema,
        path: z.string().optional().describe("Repo-relative file path; omit for full diff"),
        staged: z.boolean().optional().describe("true = staged (cached) diff"),
        context: z.number().int().min(0).max(200).optional().describe("Context lines around each hunk (default 3)"),
      },
    },
    async ({ name, path: filePath, staged, context }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitDiffPayload>(repoPath(name, "/git/diff"), {
          path: filePath,
          staged: staged ? "1" : undefined,
          context,
        });
        return { content: [{ type: "text", text: formatGitDiff(data, filePath ?? "the working tree") }] };
      }),
  );

  server.registerTool(
    "repos_git_stash",
    {
      description:
        "Stash browser: list (action=list), show, save, apply, pop, or drop. Mutating actions require confirm:true.",
      inputSchema: {
        name: nameSchema,
        action: z.enum(["list", "show", "save", "apply", "pop", "drop"]),
        ref: z.string().optional().describe("stash@{n} or n (default stash@{0})"),
        message: z.string().optional().describe("Message for save"),
        confirm: z.boolean().optional().describe("Required true for save/apply/pop/drop"),
      },
    },
    async ({ name, action, ref, message, confirm }) =>
      withDashboardErrors(async () => {
        if (action === "list") {
          const data = await dashboard.get(repoPath(name, "/git/stash"));
          return { content: [{ type: "text", text: jsonText(data) }] };
        }
        if (action !== "show" && !confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would ${action} stash${ref ? ` ${ref}` : ""}. Pass confirm:true.`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/git/stash"), { action, ref, message });
        return { content: [{ type: "text", text: jsonText(data, `Stash ${action} OK`) }] };
      }),
  );

  server.registerTool(
    "repos_git_branches",
    {
      description:
        "List branches + dirty/unpushed summary for a tracked repo (GET /branches). Requires the dashboard.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitBranchesPayload>(repoPath(name, "/branches"));
        return { content: [{ type: "text", text: formatGitBranches(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_branch",
    {
      description:
        "Branch/network actions via /branches: checkout, create-branch, delete-branch, fetch, pull, push, undo-commit. Mutating actions require confirm:true.",
      inputSchema: {
        name: nameSchema,
        action: z.enum([
          "checkout",
          "create-branch",
          "delete-branch",
          "fetch",
          "pull",
          "push",
          "undo-commit",
        ]),
        branch: z.string().optional().describe("Branch name for checkout/create/delete"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, action, branch, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would ${action}${branch ? ` ${branch}` : ""}. Pass confirm:true.`,
              },
            ],
          };
        }
        const timeout =
          action === "push" || action === "fetch" || action === "pull" ? 310_000 : 60_000;
        const data = await dashboard.post(repoPath(name, "/branches"), { action, branch }, timeout);
        return { content: [{ type: "text", text: jsonText(data, `${action} OK`) }] };
      }),
  );

  server.registerTool(
    "repos_git_commit",
    {
      description:
        "Commit staged changes (or amend) via the Git workspace branches API. Does not auto-stage unless you stage first. Requires confirm:true.",
      inputSchema: {
        name: nameSchema,
        message: z.string().describe("Commit message (conventional commits preferred)"),
        amend: z.boolean().optional().describe("Amend HEAD when appropriate"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, message, amend, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would ${amend ? "amend" : "commit"} with message: ${message}`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/branches"), {
          action: "commit",
          message,
          amend: Boolean(amend),
        });
        return { content: [{ type: "text", text: jsonText(data, amend ? "Amended" : "Committed") }] };
      }),
  );

  server.registerTool(
    "repos_git_push",
    {
      description:
        "Push the current branch to origin via the Git workspace API (hooks + timeout). Requires confirm:true.",
      inputSchema: {
        name: nameSchema,
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return { content: [{ type: "text", text: "Dry run — pass confirm:true to push." }] };
        }
        const data = await dashboard.post(repoPath(name, "/branches"), { action: "push" }, 310_000);
        return { content: [{ type: "text", text: jsonText(data, "Pushed") }] };
      }),
  );

  server.registerTool(
    "repos_git_log",
    {
      description:
        "Commit history for a tracked repo, one line per commit (hash, age, author, subject, refs). scope=current follows HEAD only, like `git log`; the default covers every branch, like the History graph. query searches commit messages (or resolves a SHA).",
      inputSchema: {
        name: nameSchema,
        limit: z.number().int().min(5).max(100).optional().describe("Max commits (default 40)"),
        offset: z.number().int().min(0).optional().describe("Commits to skip for pagination"),
        scope: z.enum(["all", "current"]).optional().describe("all branches (default) or current branch only"),
        query: z.string().trim().min(1).max(200).optional().describe("Search commit messages, or a SHA"),
      },
    },
    async ({ name, limit, offset, scope, query }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitLogPayload>(repoPath(name, "/git/log"), {
          limit: limit ?? 40,
          offset: offset ?? 0,
          scope,
          q: query,
        });
        return { content: [{ type: "text", text: formatGitLog(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_show",
    {
      description:
        "Show a commit: header, message, changed files, and the patch for one file (path, else the first changed file).",
      inputSchema: {
        name: nameSchema,
        ref: z.string().describe("Commit SHA or HEAD~n"),
        path: z.string().optional().describe("Optional file path within the commit"),
      },
    },
    async ({ name, ref, path: filePath }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitShowPayload>(repoPath(name, "/git/show"), {
          commit: ref,
          path: filePath,
        });
        return { content: [{ type: "text", text: formatGitShow(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_blame",
    {
      description:
        "Blame a file (commit, author, date per line) plus its recent history. Pass startLine/endLine for a range; pass line to scope the history to commits that touched that line.",
      inputSchema: {
        name: nameSchema,
        path: z.string().describe("Repo-relative file path"),
        startLine: z.number().int().min(1).optional().describe("First line to include (1-based)"),
        endLine: z.number().int().min(1).optional().describe("Last line to include"),
        line: z.number().int().min(1).optional().describe("Scope the history to commits touching this line"),
      },
    },
    async ({ name, path: filePath, startLine, endLine, line }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<GitBlamePayload>(
          repoPath(name, "/git/blame"),
          { path: filePath, line },
          60_000,
        );
        return { content: [{ type: "text", text: formatGitBlame(data, { startLine, endLine }) }] };
      }),
  );

  server.registerTool(
    "repos_git_conflicts",
    {
      description:
        "List conflicted files, or resolve one by writing resolved content (action=resolve). Resolve requires confirm:true.",
      inputSchema: {
        name: nameSchema,
        action: z.enum(["list", "resolve"]).optional().describe("Default list"),
        path: z.string().optional().describe("File path for resolve"),
        content: z.string().optional().describe("Resolved file contents for resolve"),
        confirm: z.boolean().optional().describe("Required true for resolve"),
      },
    },
    async ({ name, action = "list", path: filePath, content, confirm }) =>
      withDashboardErrors(async () => {
        if (action === "list") {
          const data = await dashboard.get(repoPath(name, "/git/conflicts"));
          return { content: [{ type: "text", text: jsonText(data) }] };
        }
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Dry run — would resolve ${filePath ?? "(missing path)"}. Pass confirm:true.`,
              },
            ],
          };
        }
        const data = await dashboard.post(repoPath(name, "/git/conflicts"), {
          path: filePath,
          content,
        });
        return { content: [{ type: "text", text: jsonText(data, "Resolved") }] };
      }),
  );

  server.registerTool(
    "repos_git_range",
    {
      description:
        "What a branch changes vs its base — the review-shaped diff. Merge-base range (base...head), so it shows what head added, not what it is missing. Returns ahead/behind, the changed files, and the patch (truncated past 60k chars; pass path or filesOnly). Defaults: base = the repo's trunk, head = HEAD.",
      inputSchema: {
        name: nameSchema,
        base: z
          .string()
          .optional()
          .describe("Base branch, tag or SHA — no ~/^ suffixes (default: the repo's trunk, e.g. origin/main)"),
        head: z.string().optional().describe("Head branch, tag or SHA (default HEAD)"),
        path: z.string().optional().describe("Limit the patch to one repo-relative path"),
        filesOnly: z.boolean().optional().describe("Only list changed files and counts, no patch"),
        context: z.number().int().min(0).max(200).optional().describe("Context lines around each hunk (default 3)"),
      },
    },
    async ({ name, base, head, path: filePath, filesOnly, context }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          base: string;
          head: string;
          ahead: number;
          behind: number;
          files: { path: string; status: string }[];
          lines: { text: string }[];
        }>(repoPath(name, "/git/range"), { base, head, path: filePath, context }, 60_000);
        const header =
          `${data.base}...${data.head}: ${data.ahead} commit(s) ahead, ${data.behind} behind.\n` +
          `Files (${data.files.length}):\n${data.files.map((f) => `${f.status} ${f.path}`).join("\n") || "(none)"}`;
        if (filesOnly || data.files.length === 0) return { content: [{ type: "text", text: header }] };
        const patch = data.lines.map((l) => l.text).join("\n");
        const body = capText(patch, "pass path for one file, or filesOnly to list files");
        return { content: [{ type: "text", text: `${header}\n\n${body}` }] };
      }),
  );

  server.registerTool(
    "repos_git_ci",
    {
      description:
        "CI state without leaving the repo: with no commit, the open PR for the current branch and its check rollup; with commit (hex SHA), that commit's check runs. To diagnose a failing check, follow up with prs_pipeline_investigate. Needs gh.",
      inputSchema: {
        name: nameSchema,
        commit: z
          .string()
          .regex(/^[0-9a-f]{7,40}$/, "commit must be a hex SHA")
          .optional()
          .describe("Commit SHA to check instead of the branch PR"),
      },
    },
    async ({ name, commit }) =>
      withDashboardErrors(async () => {
        type Counts = { passed: number; failed: number; pending: number };
        const fmt = (c?: Counts) => (c ? ` (${c.passed} passed, ${c.failed} failed, ${c.pending} pending)` : "");
        if (commit) {
          const data = await dashboard.get<{ state: string; counts?: Counts; reason?: string }>(
            repoPath(name, "/git/ci"),
            { commit },
            60_000,
          );
          const reason = data.reason ? ` — ${data.reason}` : "";
          return { content: [{ type: "text", text: `CI for ${commit}: ${data.state}${fmt(data.counts)}${reason}` }] };
        }
        const data = await dashboard.get<{
          pr: { number: number; title: string; url: string; checks: string; checkCounts: Counts } | null;
        }>(repoPath(name, "/git/branch-pr"), undefined, 60_000);
        if (!data.pr) {
          return {
            content: [
              { type: "text", text: "No open PR for the current branch (or detached HEAD / gh unavailable)." },
            ],
          };
        }
        const pr = data.pr;
        return {
          content: [
            { type: "text", text: `PR #${pr.number} ${pr.title}\n${pr.url}\nChecks: ${pr.checks}${fmt(pr.checkCounts)}` },
          ],
        };
      }),
  );

  server.registerTool(
    "repos_git_worktrees",
    {
      description:
        "List git worktrees, review merged cleanup, or add/remove/prune/lock/unlock. review returns GitHub merge evidence, equivalence to the current remote default branch (including rebased/squashed changes), local changes, ignored files, blockers and HEADs. Cleanup does not rebase or rewrite branches. cleanup removes only verified merged checkouts from reviewed entries (path + head), requires confirm:true, and rechecks safety; never forces. includeIgnored:true acknowledges deletion of the listed ignored local files. Branches and commits remain. prune only forgets missing folders. add creates a branch only with createBranch:true; remove refuses dirty worktrees unless force:true.",
      inputSchema: {
        name: nameSchema,
        action: z.enum(["list", "review", "cleanup", "add", "remove", "prune", "lock", "unlock"]).optional().describe("Default list"),
        branch: z.string().optional().describe("Branch for add"),
        path: z.string().optional().describe("Worktree directory (target for add; required for remove/lock/unlock)"),
        createBranch: z.boolean().optional().describe("add: create branch instead of checking out an existing one"),
        force: z.boolean().optional().describe("remove: discard the worktree's uncommitted changes"),
        entries: z.array(z.object({ path: z.string().min(1).max(4096), head: z.string().regex(/^[a-f0-9]{40,64}$/) })).min(1).max(50).optional().describe("cleanup: exact paths and HEADs returned by review"),
        confirm: z.boolean().optional().describe("cleanup: explicitly approve removing the reviewed checkouts"),
        includeIgnored: z.boolean().optional().describe("cleanup: approve deletion of the ignored files shown by review"),
      },
    },
    async ({ name, action = "list", branch, path: target, createBranch, force, entries, confirm, includeIgnored }) =>
      withDashboardErrors(async () => {
        if (action === "review") {
          const data = await dashboard.get<{ mergedCleanupSupported?: boolean }>(repoPath(name, "/worktrees"), { details: "1" }, 180_000);
          if (!data.mergedCleanupSupported) throw new Error("Rebuild the DevHub dashboard to enable verified merged-worktree cleanup.");
          return { content: [{ type: "text", text: jsonText(data) }] };
        }
        if (action === "cleanup") {
          if (confirm !== true || !entries?.length) return {
            isError: true,
            content: [{ type: "text", text: "Run review first, then supply entries (path + head) and confirm:true. No worktrees removed." }],
          };
          const capabilities = await dashboard.get<{ mergedCleanupSupported?: boolean }>(repoPath(name, "/worktrees"));
          if (!capabilities.mergedCleanupSupported) throw new Error("Rebuild the DevHub dashboard to enable verified merged-worktree cleanup.");
          const data = await dashboard.post<{ removed: string[]; errors: { path: string; error: string }[] }>(
            repoPath(name, "/worktrees"), { entries, confirmed: true, includeIgnored: includeIgnored ?? false, mergedOnly: true }, 300_000,
          );
          return { isError: data.errors.length > 0, content: [{ type: "text", text: jsonText(data) }] };
        }
        if (action === "list") {
          const data = await dashboard.get<{
            worktrees: {
              path: string;
              head: string;
              branch: string | null;
              isMain: boolean;
              detached: boolean;
              locked: boolean;
              prunable: boolean;
            }[];
          }>(repoPath(name, "/git/worktrees"));
          const lines = data.worktrees.map((w) => {
            const flags = [
              w.isMain ? "main" : null,
              w.detached ? "detached" : null,
              w.locked ? "locked" : null,
              w.prunable ? "prunable" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `- ${w.path} — ${w.branch ?? w.head.slice(0, 9)}${flags ? ` [${flags}]` : ""}`;
          });
          return { content: [{ type: "text", text: `Worktrees (${lines.length}):\n${lines.join("\n")}` }] };
        }
        const data = await dashboard.post<{ ok: boolean; path?: string; message?: string }>(
          repoPath(name, "/git/worktrees"),
          { action, branch, path: target, createBranch, force },
          130_000,
        );
        const detail = data.path ? ` → ${data.path}` : data.message ? `\n${data.message}` : "";
        return { content: [{ type: "text", text: `Worktree ${action} OK${detail}` }] };
      }),
  );
}
