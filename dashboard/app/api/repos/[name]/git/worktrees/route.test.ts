import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
  runGitRepo: vi.fn(),
}));

import { runGitRepoAsync } from "@/lib/git/repo-local";
import { POST } from "./route";

const params = { params: Promise.resolve({ name: "test-repo" }) };

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/test-repo/git/worktrees", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/repos/[name]/git/worktrees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects dash-prefixed branch names on add", async () => {
    const response = await POST(request({ action: "add", branch: "-evil", createBranch: true }), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid branch name" });
    expect(runGitRepoAsync).not.toHaveBeenCalled();
  });

  it("rejects dash-prefixed paths for remove, lock, and unlock", async () => {
    for (const action of ["remove", "lock", "unlock"] as const) {
      const response = await POST(request({ action, path: "-evil" }), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Invalid worktree path" });
    }
    expect(runGitRepoAsync).not.toHaveBeenCalled();
  });

  it("passes -- before the path on remove", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "", stderr: "" });

    const response = await POST(
      request({ action: "remove", path: "/tmp/test-repo-feature" }),
      params,
    );

    expect(response.status).toBe(200);
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", [
      "worktree",
      "remove",
      "--",
      "/tmp/test-repo-feature",
    ]);
  });

  it("passes -- before the path on lock and unlock", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "", stderr: "" });

    await POST(request({ action: "lock", path: "/tmp/wt" }), params);
    await POST(request({ action: "unlock", path: "/tmp/wt" }), params);

    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", [
      "worktree",
      "lock",
      "--",
      "/tmp/wt",
    ]);
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", [
      "worktree",
      "unlock",
      "--",
      "/tmp/wt",
    ]);
  });
});
