import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

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
  return JSON.stringify(data, null, 2);
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
      description: "Open a tracked repo in the editor (Cursor) on this machine. Requires the dashboard running.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; path: string }>(repoPath(name, "/open"));
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
              : JSON.stringify(payload, null, 2);
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
        const data = await dashboard.get<Record<string, unknown>>(repoPath(name, "/git/status"));
        return { content: [{ type: "text", text: jsonText(data) }] };
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
      description: "Get a file (or whole-repo) diff from the Git workspace API. staged=true for cached diff.",
      inputSchema: {
        name: nameSchema,
        path: z.string().optional().describe("Repo-relative file path; omit for full diff"),
        staged: z.boolean().optional().describe("true = staged (cached) diff"),
      },
    },
    async ({ name, path: filePath, staged }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<Record<string, unknown>>(repoPath(name, "/git/diff"), {
          path: filePath,
          staged: staged ? "1" : undefined,
        });
        return { content: [{ type: "text", text: jsonText(data) }] };
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
        const data = await dashboard.get(repoPath(name, "/branches"));
        return { content: [{ type: "text", text: jsonText(data) }] };
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
      description: "Commit history / graph data for a tracked repo (last N commits).",
      inputSchema: {
        name: nameSchema,
        limit: z.number().int().min(5).max(100).optional().describe("Max commits (default 40)"),
      },
    },
    async ({ name, limit }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(repoPath(name, "/git/log"), {
          limit: limit ?? 40,
        });
        return { content: [{ type: "text", text: jsonText(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_show",
    {
      description: "Show a commit (message + changed files + optional patch) via /git/show.",
      inputSchema: {
        name: nameSchema,
        ref: z.string().describe("Commit SHA or HEAD~n"),
        path: z.string().optional().describe("Optional file path within the commit"),
      },
    },
    async ({ name, ref, path: filePath }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(repoPath(name, "/git/show"), {
          ref,
          path: filePath,
        });
        return { content: [{ type: "text", text: jsonText(data) }] };
      }),
  );

  server.registerTool(
    "repos_git_blame",
    {
      description: "Blame + recent file history for a path via /git/blame.",
      inputSchema: {
        name: nameSchema,
        path: z.string().describe("Repo-relative file path"),
      },
    },
    async ({ name, path: filePath }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(
          repoPath(name, "/git/blame"),
          { path: filePath },
          60_000,
        );
        return { content: [{ type: "text", text: jsonText(data) }] };
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
}
