import { execSync } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

function git(cwd: string, cmd: string, timeout = 30_000): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout }).trim();
}

async function resolveRepoPath(
  dashboard: Context["dashboard"],
  name?: string,
  explicitPath?: string,
): Promise<string> {
  if (explicitPath) return explicitPath;
  if (!name) throw new Error("Provide repo name or path");
  const data = await dashboard.get<{ repos: { name: string; path: string }[] }>("/api/repos");
  const repo = data.repos?.find((r) => r.name === name);
  if (!repo) throw new Error(`Repo '${name}' not found. Pass an explicit path instead.`);
  return repo.path;
}

interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  remote: string | null;
  dirtyCount: number;
  unpushedCount: number;
  hasCompose: boolean;
}

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
          return { content: [{ type: "text", text: `No repos found${data.scanDirDisplay ? ` under ${data.scanDirDisplay}` : ""}.` }] };
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
      inputSchema: { name: z.string().describe("Repo name as shown by repos_list") },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; path: string }>(
          `/api/repos/${encodeURIComponent(name)}/open`,
        );
        return { content: [{ type: "text", text: `Opened ${name} (${r.path}).` }] };
      }),
  );

  server.registerTool(
    "repos_clone",
    {
      description: "Clone a GitHub repo into the DevHub repos directory. Requires the dashboard running and gh/git available.",
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
          content: [{ type: "text", text: `Cloned ${fullName}${r.repo?.path ? ` → ${r.repo.path}` : ""}.` }],
        };
      }),
  );

  server.registerTool(
    "repo_learn",
    {
      description:
        "Build (or fetch the cached) 'learn' context pack for a repo — an architecture/onboarding summary. Requires the dashboard running. May take up to a minute when refreshing.",
      inputSchema: {
        name: z.string().describe("Repo name as shown by repos_list"),
        refresh: z.boolean().optional().describe("Force a rebuild instead of using the cached pack"),
      },
    },
    async ({ name, refresh }) =>
      withDashboardErrors(async () => {
        const payload = await dashboard.get<Record<string, unknown>>(
          `/api/repos/${encodeURIComponent(name)}/learn`,
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

  const repoTarget = {
    name: z.string().optional().describe("Repo name from repos_list"),
    path: z.string().optional().describe("Absolute repo path (for repos not tracked by dashboard)"),
  };

  server.registerTool(
    "repos_git_status",
    {
      description: "Detailed git status for a repo: branch, modified/staged/untracked files, ahead/behind counts.",
      inputSchema: repoTarget,
    },
    async ({ name, path: repoPath }) => {
      const p = await resolveRepoPath(dashboard, name, repoPath);
      const branch = git(p, "branch --show-current");
      const status = git(p, "status --short");
      let aheadBehind = "";
      try { aheadBehind = git(p, `rev-list --left-right --count origin/${branch}...HEAD`); } catch {}
      const text = [
        `Repo: ${p}`,
        `Branch: ${branch}`,
        aheadBehind ? `Ahead/behind origin/${branch}: ${aheadBehind}` : null,
        "",
        status || "(clean)",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "repos_git_commit",
    {
      description: "Stage all changes (modified + untracked) and commit. Requires confirm:true.",
      inputSchema: {
        ...repoTarget,
        message: z.string().describe("Commit message (use conventional commits: feat:, fix:, chore:, etc.)"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, path: repoPath, message, confirm }) => {
      if (!confirm) return { content: [{ type: "text", text: "Dry run — pass confirm:true to execute." }] };
      const p = await resolveRepoPath(dashboard, name, repoPath);
      git(p, "add -A");
      const status = git(p, "status --short");
      if (!status) return { content: [{ type: "text", text: "Nothing to commit." }] };
      const result = git(p, `commit -m ${JSON.stringify(message)}`);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.registerTool(
    "repos_git_push",
    {
      description: "Push commits to remote. Requires confirm:true.",
      inputSchema: {
        ...repoTarget,
        remote: z.string().optional().default("origin").describe("Remote name (default: origin)"),
        branch: z.string().optional().describe("Branch to push (default: current)"),
        confirm: z.boolean().describe("Must be true to execute"),
      },
    },
    async ({ name, path: repoPath, remote, branch, confirm }) => {
      if (!confirm) return { content: [{ type: "text", text: "Dry run — pass confirm:true to execute." }] };
      const p = await resolveRepoPath(dashboard, name, repoPath);
      const b = branch || git(p, "branch --show-current");
      const result = git(p, `push ${remote} ${b}`, 60_000);
      return { content: [{ type: "text", text: result || `Pushed ${b} to ${remote}.` }] };
    },
  );
}
