import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gh-exec", () => ({
  execGh: vi.fn(),
}));

vi.mock("@/lib/github/skipped-prs", () => ({
  applySkippedPrs: async <T>(rows: T[]) => rows,
}));

import { execGh } from "@/lib/gh-exec";
import { fetchMyGithubPrs, fetchPrListMetaByUrl, resolveCanonicalRepoFullName } from "./prs";

function emptySearch(): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify({ total_count: 0, items: [] }), stderr: "" };
}

it("captures timestamped review, inline and issue feedback in the existing single bulk query", async () => {
  const url = "https://github.com/acme/app/pull/1";
  vi.mocked(execGh).mockResolvedValueOnce({ stdout: JSON.stringify({ data: { viewer: { login: "john" }, feedback: { nodes: [{ url, state: "MERGED", headRefName: "feedback", headRepository: { nameWithOwner: "acme/app" }, reviews: { nodes: [{ author: { login: "reviewer" }, submittedAt: "2026-10-19T10:00:00Z", body: "Review", state: "CHANGES_REQUESTED" }] }, comments: { nodes: [{ author: { login: "peer" }, createdAt: "2026-10-19T11:00:00Z", body: "Issue comment" }] }, reviewThreads: { nodes: [{ comments: { nodes: [{ author: { login: "ci", __typename: "Bot" }, createdAt: "2026-10-19T12:00:00Z", body: "Inline comment" }] } }] } }] } } }), stderr: "" });
  const meta = await fetchPrListMetaByUrl();
  expect(meta.get(url)?.feedback).toMatchObject({ url, state: "MERGED", self: "john", repo: "acme/app", headBranch: "feedback", activity: [{ author: "reviewer", at: "2026-10-19T10:00:00Z" }, { author: "peer", at: "2026-10-19T11:00:00Z" }, { author: "ci", bot: true, at: "2026-10-19T12:00:00Z" }] });
  expect(execGh).toHaveBeenCalledOnce();
  expect(vi.mocked(execGh).mock.calls[0][0].slice(0, 2)).toEqual(["api", "graphql"]);
});

function searchWith(url: string): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({
      total_count: 1,
      items: [
        {
          number: 1,
          title: "t",
          html_url: url,
          repository_url: "https://api.github.com/repos/acme/demo",
        },
      ],
    }),
    stderr: "",
  };
}

interface ApprovalNode {
  url: string;
  reviewDecision: string | null;
  states?: string[];
  checkRuns?: Array<{ state: string; count: number }>;
}

function approvalSearch(authored: ApprovalNode[]): { stdout: string; stderr: string } {
  const toNode = (n: ApprovalNode) => ({
    url: n.url,
    reviewDecision: n.reviewDecision,
    latestOpinionatedReviews: { nodes: (n.states ?? []).map((state) => ({ state })) },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: null,
              contexts: {
                checkRunCountsByState: n.checkRuns ?? [],
                statusContextCountsByState: [],
              },
            },
          },
        },
      ],
    },
  });
  return {
    stdout: JSON.stringify({
      data: { authored: { nodes: authored.map(toNode) }, reviewing: { nodes: [] } },
    }),
    stderr: "",
  };
}

function isGraphql(args: unknown): boolean {
  return Array.isArray(args) && args[0] === "api" && args[1] === "graphql";
}

function queryFromCall(args: unknown): string {
  const path = Array.isArray(args) ? String(args[1] ?? "") : "";
  const qIndex = path.indexOf("q=");
  if (qIndex === -1) return "";
  return decodeURIComponent(path.slice(qIndex + 2).split("&")[0] ?? "");
}

describe("fetchMyGithubPrs", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
  });

  it("lists both queues and looks up approvals over GraphQL", async () => {
    vi.mocked(execGh).mockImplementation(async (args) =>
      isGraphql(args) ? approvalSearch([]) : emptySearch(),
    );

    await fetchMyGithubPrs();

    const calls = vi.mocked(execGh).mock.calls.map((call) => call[0]);
    expect(calls.map(queryFromCall)).toEqual(
      expect.arrayContaining([
        "author:@me is:pr state:open sort:updated-desc",
        "review-requested:@me is:pr state:open sort:updated-desc",
      ]),
    );
    // `review:approved` misses PRs on repos that do not require reviews.
    expect(calls.some((args) => queryFromCall(args).includes("review:approved"))).toBe(false);
    expect(calls.filter(isGraphql)).toHaveLength(1);
  });

  it("still returns authored and review queues when the approval lookup fails", async () => {
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (isGraphql(args)) throw new Error("gh: Validation Failed (HTTP 422)");
      const q = queryFromCall(args);
      if (q.includes("author:@me")) return searchWith("https://github.com/acme/demo/pull/1");
      return searchWith("https://github.com/acme/demo/pull/2");
    });

    const { authored, reviews } = await fetchMyGithubPrs();

    expect(authored.map((r) => r.url)).toEqual(["https://github.com/acme/demo/pull/1"]);
    expect(reviews.map((r) => r.url)).toEqual(["https://github.com/acme/demo/pull/2"]);
    expect(authored[0]?.approved).toBeUndefined();
  });

  it("marks a PR approved when reviewDecision is null but a writer approved HEAD", async () => {
    const url = "https://github.com/acme/demo/pull/1";
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (isGraphql(args)) return approvalSearch([{ url, reviewDecision: null, states: ["APPROVED"] }]);
      const q = queryFromCall(args);
      return q.includes("author:@me") ? searchWith(url) : emptySearch();
    });

    const { authored } = await fetchMyGithubPrs();

    expect(authored[0]?.approved).toBe(true);
  });

  it("does not mark approved when a later review requests changes", async () => {
    const url = "https://github.com/acme/demo/pull/1";
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (isGraphql(args)) {
        return approvalSearch([
          { url, reviewDecision: "CHANGES_REQUESTED", states: ["APPROVED", "CHANGES_REQUESTED"] },
        ]);
      }
      const q = queryFromCall(args);
      return q.includes("author:@me") ? searchWith(url) : emptySearch();
    });

    const { authored } = await fetchMyGithubPrs();

    expect(authored[0]?.approved).toBeUndefined();
    expect(authored[0]?.reviewDecision).toBe("CHANGES_REQUESTED");
  });

  it("keeps changes requested actionable when the repository has no required review decision", async () => {
    const url = "https://github.com/acme/demo/pull/1";
    vi.mocked(execGh).mockImplementation(async (args) => isGraphql(args)
      ? approvalSearch([{ url, reviewDecision: null, states: ["CHANGES_REQUESTED"] }])
      : queryFromCall(args).includes("author:@me") ? searchWith(url) : emptySearch());
    expect((await fetchMyGithubPrs()).authored[0]?.reviewDecision).toBe("CHANGES_REQUESTED");
  });

  it("folds CI check buckets from the same GraphQL meta lookup", async () => {
    const url = "https://github.com/acme/demo/pull/1";
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (isGraphql(args)) {
        return approvalSearch([
          {
            url,
            reviewDecision: null,
            states: ["APPROVED"],
            checkRuns: [
              { state: "SUCCESS", count: 2 },
              { state: "FAILURE", count: 1 },
            ],
          },
        ]);
      }
      const q = queryFromCall(args);
      return q.includes("author:@me") ? searchWith(url) : emptySearch();
    });

    const { authored } = await fetchMyGithubPrs();

    expect(authored[0]?.approved).toBe(true);
    expect(authored[0]?.checks).toBe("failing");
    expect(authored[0]?.checkCounts).toEqual({ passed: 2, failed: 1, pending: 0 });
  });
});

describe("resolveCanonicalRepoFullName", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
  });

  it("follows a rename and caches the result", async () => {
    vi.mocked(execGh).mockResolvedValue({ stdout: "acme/app\n", stderr: "" });

    expect(await resolveCanonicalRepoFullName("acme/app-poc")).toBe("acme/app");
    expect(await resolveCanonicalRepoFullName("acme/app-poc")).toBe("acme/app");
    expect(execGh).toHaveBeenCalledTimes(1);
  });

  it("falls back to the input without caching when GitHub fails", async () => {
    vi.mocked(execGh).mockRejectedValueOnce(new Error("HTTP 502"));
    expect(await resolveCanonicalRepoFullName("acme/flaky")).toBe("acme/flaky");

    vi.mocked(execGh).mockResolvedValueOnce({ stdout: "acme/steady\n", stderr: "" });
    expect(await resolveCanonicalRepoFullName("acme/flaky")).toBe("acme/steady");
  });
});
