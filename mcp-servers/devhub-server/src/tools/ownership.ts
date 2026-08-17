import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface Brief {
  repo: { fullName: string };
  domains: { id: string; label: string; paths: string[]; codeowners: string[] }[];
  teams: { label: string; domains: string[] }[];
  prs: { team: string; updatedAt: string; files: { path: string }[] }[];
  gaps: { domainId: string; label: string; score: number }[];
  digest: { commits: { domains: string[] }[]; summaryMarkdown: string | null } | null;
}

function ownershipPath(repo: string, suffix: string): string {
  const [owner, name, extra] = repo.split("/");
  if (!owner || !name || extra) throw new Error("Repo must be owner/name");
  return `/api/own/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

function text(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const repoSchema = z.string().describe("Owned GitHub repo in owner/name form");

/** Rank by the prefix that matched, not the longest path sitting on the domain. */
export function owningDomainForPath<T extends { paths: string[] }>(
  domains: T[],
  filePath: string,
): T | undefined {
  let best: T | undefined;
  let bestLength = -1;
  for (const domain of domains) {
    for (const prefix of domain.paths) {
      if (prefix === "." || filePath === prefix || filePath.startsWith(`${prefix}/`)) {
        if (prefix.length > bestLength) {
          best = domain;
          bestLength = prefix.length;
        }
      }
    }
  }
  return best;
}

export function registerOwnershipTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "owned_repos",
    { description: "The repositories marked owned in DevHub, with obligation status. Requires the dashboard running." },
    async () => withDashboardErrors(async () => text(await dashboard.get("/api/own", { summary: 1 }, 120_000))),
  );

  server.registerTool(
    "repo_owner_brief",
    {
      description: "All ownership panels for one owned repo: inbound PRs, obligations, gaps, and catch-up history.",
      inputSchema: { repo: repoSchema },
    },
    async ({ repo }) => withDashboardErrors(async () => text(await dashboard.get(ownershipPath(repo, "/brief"), undefined, 120_000))),
  );

  server.registerTool(
    "repo_pr_radar",
    {
      description: "Open PRs targeting an owned repo, optionally filtered by inferred team or updated date.",
      inputSchema: {
        repo: repoSchema,
        team: z.string().optional(),
        since: z.string().optional().describe("ISO date/time; keep PRs updated at or after it"),
      },
    },
    async ({ repo, team, since }) => withDashboardErrors(async () => {
      const brief = await dashboard.get<Brief>(ownershipPath(repo, "/brief"), undefined, 120_000);
      const prs = brief.prs.filter((pr) =>
        (!team || pr.team.toLowerCase() === team.toLowerCase()) && (!since || pr.updatedAt >= since),
      );
      return text(prs);
    }),
  );

  server.registerTool(
    "repo_who_owns",
    {
      description: "Declared team/CODEOWNERS and historical reviewers for a path in an owned repo.",
      inputSchema: { repo: repoSchema, path: z.string().min(1).describe("Repo-relative path") },
    },
    async ({ repo, path }) => withDashboardErrors(async () => {
      const brief = await dashboard.get<Brief>(ownershipPath(repo, "/brief"), undefined, 120_000);
      const domain = owningDomainForPath(brief.domains, path);
      const team = brief.teams.find((candidate) => domain && candidate.domains.includes(domain.id));
      const blast = await dashboard.post(ownershipPath(repo, "/blast"), { paths: [path] }, 120_000);
      return text({ domain: domain ?? null, team: team ?? null, history: blast });
    }),
  );

  server.registerTool(
    "repo_changed_since",
    {
      description: "Commits and cached ownership digest for a repo since a commit SHA, optionally narrowed to one domain.",
      inputSchema: {
        repo: repoSchema,
        since: z.string().regex(/^[0-9a-f]{7,64}$/i, "Expected a commit SHA"),
        domain: z.string().optional(),
      },
    },
    async ({ repo, since, domain }) => withDashboardErrors(async () => {
      const digest = await dashboard.get<{ commits?: { domainIds?: string[] }[] }>(
        ownershipPath(repo, "/digest"),
        { since },
        120_000,
      );
      return text(domain
        ? { ...digest, summaryMarkdown: null, commits: (digest.commits ?? []).filter((commit) => commit.domainIds?.includes(domain)) }
        : digest);
    }),
  );

  server.registerTool(
    "repo_knowledge_gaps",
    {
      description: "Ranked domain learning queue for an owned repo, scored from inbound churn and familiarity.",
      inputSchema: { repo: repoSchema },
    },
    async ({ repo }) => withDashboardErrors(async () => text(await dashboard.get(ownershipPath(repo, "/gaps"), undefined, 120_000))),
  );
}
