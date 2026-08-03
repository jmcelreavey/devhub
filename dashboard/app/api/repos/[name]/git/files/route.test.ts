import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
}));

import { runGitRepoAsync } from "@/lib/git/repo-local";
import { GET } from "./route";

describe("GET /api/repos/[name]/git/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tracked paths from git ls-files", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({
      status: 0,
      stdout: "src/a.ts\0src/b.ts\0\0",
      stderr: "",
    });

    const response = await GET(new NextRequest("http://test/api/repos/test-repo/git/files"), {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ files: ["src/a.ts", "src/b.ts"] });
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", ["ls-files", "-z"], {
      timeout: 30_000,
    });
  });

  it("surfaces git failures", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({
      status: 128,
      stdout: "",
      stderr: "not a git repository",
    });

    const response = await GET(new NextRequest("http://test/api/repos/test-repo/git/files"), {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "not a git repository" });
  });
});
