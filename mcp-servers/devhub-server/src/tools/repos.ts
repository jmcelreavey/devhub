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
}
