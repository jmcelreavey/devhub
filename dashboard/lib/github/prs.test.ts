import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gh-exec", () => ({
  execGh: vi.fn(),
}));

vi.mock("@/lib/github/skipped-prs", () => ({
  applySkippedPrs: async <T>(rows: T[]) => rows,
}));

import { execGh } from "@/lib/gh-exec";
import { fetchMyGithubPrs } from "./prs";

function emptySearch(): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify({ total_count: 0, items: [] }), stderr: "" };
}

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

  it("does not send a grouped OR review:approved query (GitHub 422s it)", async () => {
    vi.mocked(execGh).mockResolvedValue(emptySearch());

    await fetchMyGithubPrs();

    const queries = vi.mocked(execGh).mock.calls.map((call) => queryFromCall(call[0]));
    expect(queries.some((q) => q.includes("review:approved") && /\bOR\b/.test(q))).toBe(false);
    expect(queries).toEqual(
      expect.arrayContaining([
        "author:@me is:pr state:open sort:updated-desc",
        "review-requested:@me is:pr state:open sort:updated-desc",
        "author:@me is:pr state:open review:approved",
        "review-requested:@me is:pr state:open review:approved",
      ]),
    );
  });

  it("still returns authored and review queues when the approval lookup 422s", async () => {
    vi.mocked(execGh).mockImplementation(async (args) => {
      const q = queryFromCall(args);
      if (q.includes("review:approved")) {
        throw new Error("gh: Validation Failed (HTTP 422)");
      }
      if (q.includes("author:@me") && !q.includes("review-requested")) {
        return searchWith("https://github.com/acme/demo/pull/1");
      }
      return searchWith("https://github.com/acme/demo/pull/2");
    });

    const { authored, reviews } = await fetchMyGithubPrs();

    expect(authored.map((r) => r.url)).toEqual(["https://github.com/acme/demo/pull/1"]);
    expect(reviews.map((r) => r.url)).toEqual(["https://github.com/acme/demo/pull/2"]);
    expect(authored[0]?.approved).toBeUndefined();
  });
});
