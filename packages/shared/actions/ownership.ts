import { z } from "zod";
import { defineAction } from "./define.ts";
import { isSafeRepoRelPath } from "./git-safety.ts";

export interface OwnershipResponse {
  status: number;
  body: unknown;
}

export const ownedReposInput = z.object({}).meta({ additionalProperties: false });
export const ownedRepoInput = z.object({
  repo: z.string().describe("Owned GitHub repo in owner/name form"),
}).meta({ additionalProperties: false });

export interface OwnedReposContext {
  list: () => Promise<OwnershipResponse>;
}

export interface OwnedRepoContext {
  read: (repo: string) => Promise<OwnershipResponse>;
}

export const ownedRepos = defineAction<typeof ownedReposInput, OwnedReposContext, OwnershipResponse>({
  input: ownedReposInput,
  http: { method: "GET", path: "/api/own", discriminator: "query scope is neither remote nor identity and summary=1" },
  mcp: {
    name: "owned_repos",
    toolset: "repos",
    description: "The repositories marked owned in DevHub, with obligation status. Requires the dashboard running.",
  },
  handler: (_input, context) => context.list(),
});

export const ownedReposIdentityInput = z.object({}).meta({ additionalProperties: false });
export const ownedReposIdentity = defineAction<typeof ownedReposIdentityInput, OwnedReposContext, OwnershipResponse>({
  input: ownedReposIdentityInput,
  http: { method: "GET", path: "/api/own", discriminator: "query scope=identity" },
  mcp: { reason: "The lightweight identity list is a dashboard-specific view of owned repositories." },
  handler: (_input, context) => context.list(),
});

export const ownedReposResolvedInput = z.object({}).meta({ additionalProperties: false });
export const ownedReposResolved = defineAction<typeof ownedReposResolvedInput, OwnedReposContext, OwnershipResponse>({
  input: ownedReposResolvedInput,
  http: { method: "GET", path: "/api/own", discriminator: "query scope is neither remote nor identity and summary is not 1" },
  mcp: { reason: "The dashboard uses resolved repositories without the MCP tool's obligation summary." },
  handler: (_input, context) => context.list(),
});

export const ownedReposRemoteInput = z.object({
  repos: z.array(z.object({
    fullName: z.string().max(201).regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
    // eslint-disable-next-line no-control-regex -- Git branch names cannot contain control characters.
    defaultBranch: z.string().max(255).regex(/^[^\x00-\x1f-][^\x00-\x1f]*$/).nullable(),
  })).max(256),
}).meta({ additionalProperties: false });

export const ownedReposRemote = defineAction<typeof ownedReposRemoteInput, { refresh: (repos: z.output<typeof ownedReposRemoteInput>["repos"]) => Promise<OwnershipResponse> }, OwnershipResponse>({
  input: ownedReposRemoteInput,
  http: { method: "GET", path: "/api/own", discriminator: "query scope=remote" },
  mcp: { reason: "Remote ownership refresh is an authenticated dashboard-internal operation." },
  handler: ({ repos }, context) => context.refresh(repos),
});

export const ownedRepoChangeInput = z.object({
  fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/name"),
}).meta({ additionalProperties: false });

export interface OwnedRepoChangeContext {
  change: (fullName: string) => Promise<OwnershipResponse>;
}

export const ownedRepoAdd = defineAction<typeof ownedRepoChangeInput, OwnedRepoChangeContext, OwnershipResponse>({
  input: ownedRepoChangeInput,
  http: { method: "POST", path: "/api/own" },
  mcp: { reason: "Adding ownership is a dashboard configuration operation with no MCP equivalent." },
  handler: ({ fullName }, context) => context.change(fullName),
});

export const ownedRepoRemove = defineAction<typeof ownedRepoChangeInput, OwnedRepoChangeContext, OwnershipResponse>({
  input: ownedRepoChangeInput,
  http: { method: "DELETE", path: "/api/own" },
  mcp: { reason: "Removing ownership is a dashboard configuration operation with no MCP equivalent." },
  handler: ({ fullName }, context) => context.change(fullName),
});

export const repoOwnerBrief = defineAction<typeof ownedRepoInput, OwnedRepoContext, OwnershipResponse>({
  input: ownedRepoInput,
  http: { method: "GET", path: "/api/own/[owner]/[name]/brief", discriminator: "query panels is not core" },
  mcp: {
    name: "repo_owner_brief",
    toolset: "repos",
    description: "All ownership panels for one owned repo: inbound PRs, obligations, gaps, and catch-up history.",
  },
  handler: ({ repo }, context) => context.read(repo),
});

export const repoOwnerBriefCore = defineAction<typeof ownedRepoInput, OwnedRepoContext, OwnershipResponse>({
  input: ownedRepoInput,
  http: { method: "GET", path: "/api/own/[owner]/[name]/brief", discriminator: "query panels=core" },
  mcp: { reason: "The ownership tool returns the full brief; the reduced core panel is dashboard-only." },
  handler: ({ repo }, context) => context.read(repo),
});

export const repoKnowledgeGaps = defineAction<typeof ownedRepoInput, OwnedRepoContext, OwnershipResponse>({
  input: ownedRepoInput,
  http: { method: "GET", path: "/api/own/[owner]/[name]/gaps" },
  mcp: {
    name: "repo_knowledge_gaps",
    toolset: "repos",
    description: "Ranked domain learning queue for an owned repo, scored from inbound churn and familiarity.",
  },
  handler: ({ repo }, context) => context.read(repo),
});

export interface OwnershipBrief {
  repo: { fullName: string };
  domains: { id: string; label: string; paths: string[]; codeowners: string[] }[];
  teams: { label: string; domains: string[] }[];
  prs: { team: string; updatedAt: string; files: { path: string }[] }[];
  gaps: { domainId: string; label: string; score: number }[];
  digest: { commits: { domains: string[] }[]; summaryMarkdown: string | null } | null;
}

export function owningDomainForPath<Domain extends { paths: string[] }>(domains: Domain[], filePath: string): Domain | undefined {
  let best: Domain | undefined;
  let bestLength = -1;
  for (const domain of domains) {
    for (const prefix of domain.paths) {
      if ((prefix === "." || filePath === prefix || filePath.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = domain;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export const repoPrRadarInput = ownedRepoInput.extend({
  team: z.string().optional(),
  since: z.string().optional().describe("ISO date/time; keep PRs updated at or after it"),
}).meta({ additionalProperties: false });

export interface RepoPrRadarContext {
  brief: (repo: string) => Promise<OwnershipBrief>;
}

export const repoPrRadar = defineAction<typeof repoPrRadarInput, RepoPrRadarContext, OwnershipBrief["prs"]>({
  input: repoPrRadarInput,
  http: { reason: "This filtered radar is composed from the existing ownership brief; there is no separate HTTP route." },
  mcp: {
    name: "repo_pr_radar",
    toolset: "repos",
    description: "Open PRs targeting an owned repo, optionally filtered by inferred team or updated date.",
  },
  handler: async ({ repo, team, since }, context) => {
    const brief = await context.brief(repo);
    return brief.prs.filter((pr) =>
      (!team || pr.team.toLowerCase() === team.toLowerCase()) && (!since || pr.updatedAt >= since),
    );
  },
});

export const repoWhoOwnsInput = ownedRepoInput.extend({
  path: z.string().min(1).describe("Repo-relative path"),
}).meta({ additionalProperties: false });

export interface RepoWhoOwnsContext {
  brief: (repo: string) => Promise<OwnershipBrief>;
  blast: (repo: string, path: string) => Promise<unknown>;
}

export interface RepoWhoOwnsResult {
  domain: OwnershipBrief["domains"][number] | null;
  team: OwnershipBrief["teams"][number] | null;
  history: unknown;
}

export const repoWhoOwns = defineAction<typeof repoWhoOwnsInput, RepoWhoOwnsContext, RepoWhoOwnsResult>({
  input: repoWhoOwnsInput,
  http: { reason: "Ownership and reviewer history are composed from the existing brief and blast routes." },
  mcp: {
    name: "repo_who_owns",
    toolset: "repos",
    description: "Declared team/CODEOWNERS and historical reviewers for a path in an owned repo.",
  },
  handler: async ({ repo, path }, context) => {
    const brief = await context.brief(repo);
    const domain = owningDomainForPath(brief.domains, path);
    const team = brief.teams.find((candidate) => domain && candidate.domains.includes(domain.id));
    return { domain: domain ?? null, team: team ?? null, history: await context.blast(repo, path) };
  },
});

export const repoChangedSinceInput = ownedRepoInput.extend({
  since: z.string().regex(/^[0-9a-f]{7,64}$/i, "Expected a commit SHA"),
  domain: z.string().optional(),
}).meta({ additionalProperties: false });

export interface RepoChangedSinceContext {
  digest: (repo: string, since: string) => Promise<{ commits?: { domainIds?: string[] }[]; [key: string]: unknown }>;
}

export const repoChangedSince = defineAction<typeof repoChangedSinceInput, RepoChangedSinceContext, Record<string, unknown>>({
  input: repoChangedSinceInput,
  http: { reason: "Domain filtering is an MCP composition over the existing digest route." },
  mcp: {
    name: "repo_changed_since",
    toolset: "repos",
    description: "Commits and cached ownership digest for a repo since a commit SHA, optionally narrowed to one domain.",
  },
  handler: async ({ repo, since, domain }, context) => {
    const digest = await context.digest(repo, since);
    return domain
      ? { ...digest, summaryMarkdown: null, commits: (digest.commits ?? []).filter((commit) => commit.domainIds?.includes(domain)) }
      : digest;
  },
});

export const ownerDigestInput = ownedRepoInput.extend({ since: z.string().optional() }).meta({ additionalProperties: false });

export interface OwnerDigestContext {
  read: (input: z.output<typeof ownerDigestInput>) => Promise<OwnershipResponse>;
}

export const ownerDigest = defineAction<typeof ownerDigestInput, OwnerDigestContext, OwnershipResponse>({
  input: ownerDigestInput,
  http: { method: "GET", path: "/api/own/[owner]/[name]/digest" },
  mcp: { reason: "The MCP digest tool composes filtering over this existing route." },
  handler: (input, context) => context.read(input),
});

const ownershipSha = z.string().regex(/^[0-9a-f]{7,64}$/i);

export interface OwnershipWriteContext<Input> {
  write: (input: Input) => Promise<OwnershipResponse>;
}

export const ownerVisitInput = ownedRepoInput.extend({ headSha: ownershipSha }).meta({ additionalProperties: false });
export const ownerVisit = defineAction<typeof ownerVisitInput, OwnershipWriteContext<z.output<typeof ownerVisitInput>>, OwnershipResponse>({
  input: ownerVisitInput,
  http: { method: "POST", path: "/api/own/[owner]/[name]/brief" },
  mcp: { reason: "Recording a visit is a dashboard ownership workflow without a corresponding MCP mutation." },
  handler: (input, context) => context.write(input),
});

export const ownerLearnOpenedInput = ownedRepoInput.extend({
  action: z.literal("learn-opened"),
  domainId: z.string().min(1).max(120),
}).meta({ additionalProperties: false });
export const ownerLearnOpened = defineAction<typeof ownerLearnOpenedInput, OwnershipWriteContext<z.output<typeof ownerLearnOpenedInput>>, OwnershipResponse>({
  input: ownerLearnOpenedInput,
  http: { method: "POST", path: "/api/own/[owner]/[name]/gaps" },
  mcp: { reason: "Marking a learning panel opened is a dashboard-only ownership workflow." },
  handler: (input, context) => context.write(input),
});

export const ownerDigestGenerateInput = ownedRepoInput.extend({
  sinceSha: ownershipSha.nullable().optional(),
  headSha: ownershipSha.optional(),
}).meta({ additionalProperties: false });
export const ownerDigestGenerate = defineAction<typeof ownerDigestGenerateInput, OwnershipWriteContext<z.output<typeof ownerDigestGenerateInput>>, OwnershipResponse>({
  input: ownerDigestGenerateInput,
  http: { method: "POST", path: "/api/own/[owner]/[name]/digest" },
  mcp: { reason: "Generating a digest is a dashboard-only action; the MCP digest tool reads cached results." },
  handler: (input, context) => context.write(input),
});

export const ownerBlastInput = ownedRepoInput.extend({
  paths: z.array(z.string().min(1).max(500).refine(isSafeRepoRelPath, "Unsafe repo path")).min(1).max(2000),
}).meta({ additionalProperties: false });
export const ownerBlast = defineAction<typeof ownerBlastInput, OwnershipWriteContext<z.output<typeof ownerBlastInput>>, OwnershipResponse>({
  input: ownerBlastInput,
  http: { method: "POST", path: "/api/own/[owner]/[name]/blast" },
  mcp: { reason: "The MCP ownership tool composes its single-path lookup through this route." },
  handler: (input, context) => context.write(input),
});
