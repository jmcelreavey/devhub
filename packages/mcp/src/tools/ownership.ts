import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ownedRepos, repoChangedSince, repoKnowledgeGaps, repoOwnerBrief, repoPrRadar, repoWhoOwns, type OwnershipBrief } from "../../../../packages/shared/actions/ownership.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

export { owningDomainForPath } from "../../../../packages/shared/actions/ownership.ts";

function ownershipPath(repo: string, suffix: string): string {
  const [owner, name, extra] = repo.split("/");
  if (!owner || !name || extra) throw new Error("Repo must be owner/name");
  return `/api/own/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

function text(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function executeDashboardAction(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return withDashboardErrors(async () => await operation() as DashboardToolResult);
}

export function registerOwnershipTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server, ownedRepos,
    { list: async () => ({ status: 200, body: await dashboard.get("/api/own", { summary: 1 }, 120_000) }) },
    (response) => text(response.body),
    executeDashboardAction,
  );

  registerAction(
    server, repoOwnerBrief,
    { read: async (repo) => ({ status: 200, body: await dashboard.get(ownershipPath(repo, "/brief"), undefined, 120_000) }) },
    (response) => text(response.body),
    executeDashboardAction,
  );

  registerAction(
    server, repoPrRadar,
    { brief: (repo) => dashboard.get<OwnershipBrief>(ownershipPath(repo, "/brief"), undefined, 120_000) },
    text,
    executeDashboardAction,
  );

  registerAction(
    server, repoWhoOwns,
    {
      brief: (repo) => dashboard.get<OwnershipBrief>(ownershipPath(repo, "/brief"), undefined, 120_000),
      blast: (repo, path) => dashboard.post(ownershipPath(repo, "/blast"), { paths: [path] }, 120_000),
    },
    text,
    executeDashboardAction,
  );

  registerAction(
    server, repoChangedSince,
    { digest: (repo, since) => dashboard.get(ownershipPath(repo, "/digest"), { since }, 120_000) },
    text,
    executeDashboardAction,
  );

  registerAction(
    server, repoKnowledgeGaps,
    { read: async (repo) => ({ status: 200, body: await dashboard.get(ownershipPath(repo, "/gaps"), undefined, 120_000) }) },
    (response) => text(response.body),
    executeDashboardAction,
  );
}
