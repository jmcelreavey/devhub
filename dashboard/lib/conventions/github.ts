/**
 * What the miner reads from GitHub: recent PRs with their review feedback, and
 * the repo's own written guidance.
 *
 * One GraphQL query returns the lot — threads (with resolved/outdated state, which
 * REST comments don't carry), review bodies and conversation comments for the last
 * N PRs — so a run costs one `gh` call plus one per guidance file, not 2N+1.
 */
import { execGh } from "@/lib/gh-exec";
import { parseOwnerRepo } from "@/lib/github/repo-name";
import type { FeedbackComment, PrFeedback } from "./feedback";

const GRAPHQL_TIMEOUT_MS = 90_000;
const GRAPHQL_MAX_BUFFER = 40 * 1024 * 1024;

/** Where teams write their rules down, in the order a human would look. */
export const GUIDANCE_PATHS = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".github/copilot-instructions.md"] as const;
const MAX_GUIDANCE_CHARS = 8_000;

export interface GuidanceDoc {
  path: string;
  content: string;
}

const QUERY = `
query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequests(first:$n,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
  number title url state updatedAt author{login}
  reviewThreads(first:40){nodes{isResolved isOutdated resolvedBy{login} path comments(first:8){nodes{id url body createdAt authorAssociation author{login __typename}}}}}
  reviews(first:20){nodes{id url body createdAt authorAssociation author{login __typename}}}
  comments(first:20){nodes{id url body createdAt authorAssociation author{login __typename}}}
}}}}`;

interface GqlActor {
  login?: string;
  __typename?: string;
}
interface GqlComment {
  id: string;
  url: string;
  body?: string | null;
  createdAt: string;
  authorAssociation?: string | null;
  author?: GqlActor | null;
}
interface GqlPr {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  updatedAt: string;
  author?: GqlActor | null;
  reviewThreads?: {
    nodes?: Array<{
      isResolved?: boolean;
      isOutdated?: boolean;
      resolvedBy?: GqlActor | null;
      path?: string | null;
      comments?: { nodes?: GqlComment[] };
    }>;
  };
  reviews?: { nodes?: GqlComment[] };
  comments?: { nodes?: GqlComment[] };
}

function toComment(
  raw: GqlComment,
  kind: FeedbackComment["kind"],
  extra: Partial<FeedbackComment> = {},
): FeedbackComment | null {
  const body = raw.body?.trim();
  if (!body || !raw.author?.login) return null;
  return {
    id: raw.id,
    url: raw.url,
    author: raw.author.login,
    isBot: raw.author.__typename === "Bot",
    association: raw.authorAssociation ?? "",
    body,
    at: raw.createdAt,
    kind,
    ...extra,
  };
}

/** Exported for tests — turns the GraphQL payload into the miner's shape. */
export function parseFeedbackPayload(payload: unknown): PrFeedback[] {
  const nodes = (payload as { data?: { repository?: { pullRequests?: { nodes?: GqlPr[] } } } })?.data?.repository
    ?.pullRequests?.nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes.map((pr) => {
    const comments: FeedbackComment[] = [];
    const prAuthor = pr.author?.login?.toLowerCase() ?? "";
    for (const thread of pr.reviewThreads?.nodes ?? []) {
      const nodes = thread.comments?.nodes ?? [];
      const resolved = thread.isResolved === true;
      const outdated = thread.isOutdated === true;
      const authorResolved = resolved && !!prAuthor && thread.resolvedBy?.login?.toLowerCase() === prAuthor;
      // A reply can disagree. Only short, explicit completion acknowledgements count.
      const acknowledgesChange = /^(?:done|fixed|updated|changed|addressed|applied|implemented|resolved)(?:[!.,\s]+(?:thanks|thank you))?[!.\s]*$/i;
      // Every comment, not just the opener: a second reviewer's "yes, our pattern
      // is…" is often the clearest statement of the rule. The author's own replies
      // ("done") are dropped later by the substantive filter.
      for (const [index, raw] of nodes.entries()) {
        const authorConfirmed = nodes.slice(index + 1).some((reply) =>
          !!prAuthor && reply.author?.login?.toLowerCase() === prAuthor && acknowledgesChange.test(reply.body?.trim() ?? ""),
        );
        const comment = toComment(raw, "inline", {
          path: thread.path ?? undefined,
          resolved,
          outdated,
          actedOn: outdated && (authorResolved || authorConfirmed),
        });
        if (comment) comments.push(comment);
      }
    }
    for (const review of pr.reviews?.nodes ?? []) {
      const comment = toComment(review, "review");
      if (comment) comments.push(comment);
    }
    for (const conversation of pr.comments?.nodes ?? []) {
      const comment = toComment(conversation, "conversation");
      if (comment) comments.push(comment);
    }
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt,
      comments,
    };
  });
}

export async function fetchRepoFeedback(repo: string, limit: number): Promise<PrFeedback[]> {
  const parsed = parseOwnerRepo(repo);
  if (!parsed) throw new Error(`Not a GitHub repo: ${repo}`);
  // -f sends strings verbatim; -F would turn an all-digit repo name into an int.
  const { stdout } = await execGh(
    ["api", "graphql", "-f", `o=${parsed.owner}`, "-f", `r=${parsed.name}`, "-F", `n=${limit}`, "-f", `query=${QUERY}`],
    { timeoutMs: GRAPHQL_TIMEOUT_MS, maxBuffer: GRAPHQL_MAX_BUFFER },
  );
  return parseFeedbackPayload(JSON.parse(stdout));
}

/** Guidance files that exist on the default branch. A missing file is normal, not an error. */
export async function fetchRepoGuidance(repo: string): Promise<GuidanceDoc[]> {
  const parsed = parseOwnerRepo(repo);
  if (!parsed) throw new Error(`Not a GitHub repo: ${repo}`);
  const docs = await Promise.all(
    GUIDANCE_PATHS.map(async (path): Promise<GuidanceDoc | null> => {
      try {
        const { stdout } = await execGh(
          ["api", "-H", "Accept: application/vnd.github.raw", `repos/${parsed.owner}/${parsed.name}/contents/${path}`],
          { timeoutMs: 20_000 },
        );
        const content = stdout.trim();
        return content ? { path, content: content.slice(0, MAX_GUIDANCE_CHARS) } : null;
      } catch {
        return null;
      }
    }),
  );
  return docs.filter((doc): doc is GuidanceDoc => doc !== null);
}
