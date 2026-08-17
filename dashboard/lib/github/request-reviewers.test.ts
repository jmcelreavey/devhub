import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/gh-exec", () => ({
  execGh: vi.fn(),
}));
vi.mock("@/lib/standup/github-merged", () => ({
  getGithubLogin: vi.fn(async () => "jmcelreavey"),
}));
vi.mock("@/lib/people/repo-people", () => ({
  loadRepoPeople: vi.fn(),
}));
vi.mock("@/lib/repos", () => ({
  getReposScanDir: vi.fn(() => "/tmp/no-such-devhub-repos"),
  getGithubFullNameForLocalRepo: vi.fn(() => null),
}));

import { execGh } from "@/lib/gh-exec";
import {
  attachRequestedReviewers,
  buildRequestReviewersArgs,
  parseGithubLogins,
  parseOwnerRepo,
  requestPrReviewers,
  usersFromRestReviewers,
  usersFromReviewRequestNodes,
} from "./request-reviewers";

describe("parseGithubLogins", () => {
  it("splits on commas and whitespace, then dedupes", () => {
    expect(parseGithubLogins("Ada, ada bob\ncarol")).toEqual(["Ada", "bob", "carol"]);
  });

  it("drops invalid tokens rather than throwing", () => {
    expect(parseGithubLogins(["-ada", "ok-user", "nope!", "ab"])).toEqual(["ok-user", "ab"]);
  });

  it("accepts a one-character login", () => {
    expect(parseGithubLogins("a")).toEqual(["a"]);
  });
});

describe("parseOwnerRepo", () => {
  it("splits owner/name", () => {
    expect(parseOwnerRepo("acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  it("rejects junk", () => {
    expect(parseOwnerRepo("../etc/passwd")).toBeNull();
    expect(parseOwnerRepo("no-slash")).toBeNull();
  });
});

describe("buildRequestReviewersArgs", () => {
  it("posts to the requested_reviewers REST endpoint", () => {
    expect(buildRequestReviewersArgs("acme/widgets", 12, ["ada", "bob"])).toEqual([
      "api",
      "--method",
      "POST",
      "repos/acme/widgets/pulls/12/requested_reviewers",
      "-f",
      "reviewers[]=ada",
      "-f",
      "reviewers[]=bob",
    ]);
  });
});

describe("usersFromReviewRequestNodes", () => {
  it("keeps User logins and skips empty reviewers", () => {
    expect(
      usersFromReviewRequestNodes([
        { requestedReviewer: { login: "ada", avatarUrl: "https://avatars.example/ada" } },
        { requestedReviewer: null },
        { requestedReviewer: { login: "Ada" } },
      ]),
    ).toEqual([{ login: "ada", avatarUrl: "https://avatars.example/ada" }]);
  });
});

describe("usersFromRestReviewers", () => {
  it("reads requested_reviewers from a pull payload", () => {
    expect(
      usersFromRestReviewers({
        requested_reviewers: [{ login: "ada", avatar_url: "https://avatars.example/ada" }],
      }),
    ).toEqual([{ login: "ada", avatarUrl: "https://avatars.example/ada" }]);
  });
});

describe("requestPrReviewers", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
  });

  it("rejects a body with no valid logins before calling gh", async () => {
    await expect(
      requestPrReviewers({ repo: "acme/widgets", number: 1, reviewers: ["-nope"] }),
    ).rejects.toThrow(/valid GitHub username/);
    expect(execGh).not.toHaveBeenCalled();
  });

  it("returns the updated requested reviewers from the POST body", async () => {
    vi.mocked(execGh).mockResolvedValue({
      stdout: JSON.stringify({
        requested_reviewers: [{ login: "ada", avatar_url: "https://avatars.example/ada" }],
      }),
      stderr: "",
    });

    await expect(
      requestPrReviewers({ repo: "acme/widgets", number: 9, reviewers: ["ada"] }),
    ).resolves.toEqual([{ login: "ada", avatarUrl: "https://avatars.example/ada" }]);
  });
});

describe("attachRequestedReviewers", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
  });

  it("overlays GraphQL reviewRequests onto matching authored rows", async () => {
    vi.mocked(execGh).mockResolvedValue({
      stdout: JSON.stringify({
        data: {
          viewer: {
            pullRequests: {
              nodes: [
                {
                  url: "https://github.com/acme/widgets/pull/9",
                  reviewRequests: {
                    nodes: [{ requestedReviewer: { login: "ada" } }],
                  },
                },
              ],
            },
          },
        },
      }),
      stderr: "",
    });

    const rows = await attachRequestedReviewers([
      {
        repo: "acme/widgets",
        number: 9,
        title: "Fix search",
        url: "https://github.com/acme/widgets/pull/9",
      },
      {
        repo: "acme/other",
        number: 1,
        title: "Unrelated",
        url: "https://github.com/acme/other/pull/1",
      },
    ]);

    expect(rows[0]?.requestedReviewers).toEqual([{ login: "ada" }]);
    expect(rows[1]?.requestedReviewers).toBeUndefined();
  });

  it("leaves rows unchanged when GraphQL fails", async () => {
    vi.mocked(execGh).mockRejectedValue(new Error("graphql down"));
    const rows = [
      { repo: "acme/widgets", number: 9, title: "Fix search", url: "https://github.com/acme/widgets/pull/9" },
    ];
    await expect(attachRequestedReviewers(rows)).resolves.toEqual(rows);
  });
});
