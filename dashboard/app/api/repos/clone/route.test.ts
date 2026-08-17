import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/repos", () => ({
  cloneGithubRepo: vi.fn(async (fullName: string) => ({ name: fullName.split("/")[1], path: `/tmp/${fullName}` })),
  cloneRemoteRepo: vi.fn(async (url: string, name?: string) => ({
    name: name ?? "cloned",
    path: `/tmp/${name ?? "cloned"}`,
    url,
  })),
}));

import { cloneGithubRepo, cloneRemoteRepo } from "@/lib/repos";
import { POST } from "./route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/clone", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/repos/clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still clones owner/repo via GitHub", async () => {
    const response = await POST(request({ fullName: "org/repo" }));
    expect(response.status).toBe(200);
    expect(cloneGithubRepo).toHaveBeenCalledWith("org/repo");
    expect(cloneRemoteRepo).not.toHaveBeenCalled();
  });

  it("clones a generic URL into the scan dir", async () => {
    const response = await POST(request({ url: "https://github.com/org/repo.git", name: "repo" }));
    expect(response.status).toBe(200);
    expect(cloneRemoteRepo).toHaveBeenCalledWith("https://github.com/org/repo.git", "repo");
    expect(cloneGithubRepo).not.toHaveBeenCalled();
  });
});
