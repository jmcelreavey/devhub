import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/gh-exec", () => ({
  isGithubCliAuthenticated: vi.fn(async () => true),
  mapGithubCliError: vi.fn((err: unknown) => ({
    status: 500,
    error: err instanceof Error ? err.message : String(err),
  })),
}));
vi.mock("@/lib/github/prs", () => ({
  invalidateGithubPrsCache: vi.fn(),
}));
vi.mock("@/lib/github/request-reviewers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/request-reviewers")>(
    "@/lib/github/request-reviewers",
  );
  return {
    ...actual,
    fetchPrReviewerContext: vi.fn(),
    requestPrReviewers: vi.fn(),
  };
});

const { GET, POST } = await import("./route");
const { fetchPrReviewerContext, requestPrReviewers } = await import("@/lib/github/request-reviewers");
const { invalidateGithubPrsCache } = await import("@/lib/github/prs");

function authed(method: string, body?: unknown, url = "http://localhost:1337/api/github/prs/reviewers") {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:1337",
      host: "localhost:1337",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/github/prs/reviewers", () => {
  beforeEach(() => {
    vi.mocked(fetchPrReviewerContext).mockReset();
  });

  it("rejects a missing repo", async () => {
    const res = await GET(authed("GET", undefined, "http://localhost:1337/api/github/prs/reviewers?number=1"));
    expect(res.status).toBe(400);
  });

  it("returns requested and suggested reviewers", async () => {
    vi.mocked(fetchPrReviewerContext).mockResolvedValue({
      requested: [{ login: "ada" }],
      suggested: [{ login: "bob" }],
    });
    const res = await GET(
      authed("GET", undefined, "http://localhost:1337/api/github/prs/reviewers?repo=acme/widgets&number=9"),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      requested: [{ login: "ada" }],
      suggested: [{ login: "bob" }],
    });
  });
});

describe("POST /api/github/prs/reviewers", () => {
  beforeEach(() => {
    vi.mocked(requestPrReviewers).mockReset();
    vi.mocked(invalidateGithubPrsCache).mockReset();
  });

  it("rejects a request without a same-origin browser origin", async () => {
    const res = await POST(
      new NextRequest("http://localhost:1337/api/github/prs/reviewers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "acme/widgets", number: 9, reviewers: ["ada"] }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(requestPrReviewers).not.toHaveBeenCalled();
  });

  it("rejects a body with no valid usernames", async () => {
    const res = await POST(authed("POST", { repo: "acme/widgets", number: 9, reviewers: ["-nope"] }));
    expect(res.status).toBe(400);
    expect(requestPrReviewers).not.toHaveBeenCalled();
  });

  it("requests reviewers and busts the PR list cache", async () => {
    vi.mocked(requestPrReviewers).mockResolvedValue([{ login: "ada" }]);
    const res = await POST(authed("POST", { repo: "acme/widgets", number: 9, reviewers: ["ada"] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, requested: [{ login: "ada" }] });
    expect(requestPrReviewers).toHaveBeenCalledWith({
      repo: "acme/widgets",
      number: 9,
      reviewers: ["ada"],
    });
    expect(invalidateGithubPrsCache).toHaveBeenCalled();
  });
});
