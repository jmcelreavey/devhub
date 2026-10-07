import { describe, expect, it } from "vitest";
import { parseFeedbackPayload } from "./github";

function comment(id: string, login: string | null, body: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://github.com/o/r/pull/7#${id}`,
    body,
    createdAt: "2026-10-05T10:00:00Z",
    authorAssociation: "MEMBER",
    author: login ? { login, __typename: "User" } : null,
    ...extra,
  };
}

const payload = {
  data: {
    repository: {
      pullRequests: {
        nodes: [
          {
            number: 7,
            title: "Add offers",
            url: "https://github.com/o/r/pull/7",
            state: "OPEN",
            updatedAt: "2026-10-05T12:00:00Z",
            author: { login: "pr-author" },
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  isOutdated: false,
                  path: "src/offers/routes.js",
                  comments: { nodes: [comment("t1", "reviewer-a", "our pattern is one file per handler"), comment("t2", "pr-author", "done")] },
                },
              ],
            },
            reviews: { nodes: [comment("r1", "reviewer-b", "Please follow the config pattern", { author: { login: "reviewer-b", __typename: "User" } })] },
            comments: { nodes: [comment("c1", "dependabot", "bumped", { author: { login: "dependabot", __typename: "Bot" } }), comment("c2", null, "ghost")] },
          },
        ],
      },
    },
  },
};

describe("parseFeedbackPayload", () => {
  const [pr] = parseFeedbackPayload(payload);

  it("maps the PR", () => {
    expect(pr).toMatchObject({ number: 7, title: "Add offers", state: "OPEN", author: "pr-author" });
  });

  it("keeps every comment in a thread, with the thread's path and resolved state", () => {
    const inline = pr.comments.filter((c) => c.kind === "inline");
    expect(inline.map((c) => c.author)).toEqual(["reviewer-a", "pr-author"]);
    expect(inline[0]).toMatchObject({ path: "src/offers/routes.js", resolved: true, outdated: false, association: "MEMBER" });
  });

  it("includes review bodies and conversation comments, flagging bots", () => {
    expect(pr.comments.find((c) => c.kind === "review")).toMatchObject({ author: "reviewer-b" });
    expect(pr.comments.find((c) => c.author === "dependabot")).toMatchObject({ kind: "conversation", isBot: true });
  });

  it("skips comments with no body or no author", () => {
    expect(pr.comments.some((c) => c.id === "c2")).toBe(false);
    const [empty] = parseFeedbackPayload({
      data: { repository: { pullRequests: { nodes: [{ ...payload.data.repository.pullRequests.nodes[0], reviews: { nodes: [comment("r2", "x", "")] }, reviewThreads: { nodes: [] }, comments: { nodes: [] } }] } } },
    });
    expect(empty.comments).toEqual([]);
  });

  it("returns nothing for an error or empty payload", () => {
    expect(parseFeedbackPayload({ errors: [{ message: "boom" }] })).toEqual([]);
    expect(parseFeedbackPayload(null)).toEqual([]);
  });
});

describe("parseFeedbackPayload: did the author act on it?", () => {
  function threadPayload(thread: { isResolved: boolean; isOutdated: boolean; resolvedBy?: string; replies?: string[] }) {
    const nodes = [comment("t1", "reviewer-a", "our pattern is one file per handler"), ...(thread.replies ?? []).map((login, i) => comment(`t${i + 2}`, login, "Done, thanks!"))];
    return {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 9,
                title: "x",
                url: "https://github.com/o/r/pull/9",
                state: "MERGED",
                updatedAt: "2026-10-05T12:00:00Z",
                author: { login: "PR-Author" },
                reviewThreads: { nodes: [{ isResolved: thread.isResolved, isOutdated: thread.isOutdated, resolvedBy: thread.resolvedBy ? { login: thread.resolvedBy } : null, path: "a.js", comments: { nodes } }] },
                reviews: { nodes: [] },
                comments: { nodes: [] },
              },
            ],
          },
        },
      },
    };
  }
  const reviewer = (payload: unknown) => parseFeedbackPayload(payload)[0].comments.find((c) => c.author === "reviewer-a");

  it("is true when the code changed and the author resolved the thread", () => {
    expect(reviewer(threadPayload({ isResolved: true, isOutdated: true, resolvedBy: "pr-author" }))?.actedOn).toBe(true);
  });

  it("is true when the code changed and the author replied, even if nobody resolved it", () => {
    expect(reviewer(threadPayload({ isResolved: false, isOutdated: true, replies: ["pr-author"] }))?.actedOn).toBe(true);
  });

  it("does not treat disagreement from the author as acceptance", () => {
    const input = threadPayload({ isResolved: false, isOutdated: true, replies: ["pr-author"] });
    input.data.repository.pullRequests.nodes[0].reviewThreads.nodes[0].comments.nodes[1].body = "No, we should keep the current layout.";
    expect(reviewer(input)?.actedOn).toBe(false);
  });

  it("does not infer author agreement from a thread resolved by someone else", () => {
    expect(reviewer(threadPayload({ isResolved: true, isOutdated: true }))?.actedOn).toBe(false);
  });

  it("is false for a thread resolved without the code changing — that may be a question answered with no", () => {
    expect(reviewer(threadPayload({ isResolved: true, isOutdated: false }))?.actedOn).toBe(false);
  });

  it("is false when the code changed but nobody closed the loop — that may just be a rebase", () => {
    expect(reviewer(threadPayload({ isResolved: false, isOutdated: true }))?.actedOn).toBe(false);
  });

  it("does not count another reviewer's reply as the author agreeing", () => {
    expect(reviewer(threadPayload({ isResolved: false, isOutdated: true, replies: ["reviewer-b"] }))?.actedOn).toBe(false);
  });

  it("applies to every comment in the thread, and still records the raw flags", () => {
    const [pr] = parseFeedbackPayload(threadPayload({ isResolved: true, isOutdated: true, resolvedBy: "pr-author", replies: ["reviewer-b"] }));
    expect(pr.comments.every((c) => c.actedOn === true && c.resolved === true && c.outdated === true)).toBe(true);
  });
});
