import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
}));

vi.mock("@/lib/git/conflicts", () => ({
  detectUnmergedFiles: vi.fn(() => []),
}));

import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { POST } from "./route";

const params = { params: Promise.resolve({ name: "test-repo" }) };
const hash = "a".repeat(40);

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/test-repo/git/commit-action", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/repos/[name]/git/commit-action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cherry-picks a non-merge commit on a clean tree", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${hash}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
      if (args[0] === "cherry-pick") return { status: 0, stdout: "ok\n", stderr: "" };
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const response = await POST(request({ action: "cherry-pick", commit: hash }), params);

    expect(response.status).toBe(200);
    expect(runGitRepoAsync).toHaveBeenCalledWith(
      "/tmp/test-repo",
      ["cherry-pick", hash],
      { timeout: 120_000 },
    );
  });

  it("returns conflicts without aborting the cherry-pick", async () => {
    vi.mocked(detectUnmergedFiles).mockReturnValue([
      { path: "src/a.ts", status: "UU", source: "unmerged" },
    ]);
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${hash}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
      if (args[0] === "cherry-pick") {
        return { status: 1, stdout: "", stderr: "CONFLICT (content): src/a.ts\n" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const response = await POST(request({ action: "cherry-pick", commit: hash }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      action: "cherry-pick",
      conflictFiles: ["src/a.ts"],
    });
  });

  it("creates a validated tag at the commit", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "", stderr: "" });

    const response = await POST(request({ action: "tag", commit: hash, name: "v1.2.3" }), params);

    expect(response.status).toBe(200);
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", ["tag", "v1.2.3", hash]);
  });

  it("takes a backup before a hard reset", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/test\n", stderr: "" };
      }
      return { status: 0, stdout: `${hash}\n`, stderr: "" };
    });

    const response = await POST(request({ action: "reset-to-commit", commit: hash }), params);

    expect(response.status).toBe(200);
    expect(runGitRepoAsync).toHaveBeenCalledWith(
      "/tmp/test-repo",
      expect.arrayContaining(["branch", expect.stringMatching(/^devhub\/backup-/), "HEAD"]),
    );
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", ["reset", "--hard", hash]);
  });

  it("does not reset when the backup branch cannot be created", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/test\n", stderr: "" };
      }
      if (args[0] === "branch") {
        return { status: 1, stdout: "", stderr: "cannot lock ref\n" };
      }
      return { status: 0, stdout: `${hash}\n`, stderr: "" };
    });

    const response = await POST(request({ action: "reset-to-commit", commit: hash }), params);

    expect(response.status).toBe(500);
    expect(runGitRepoAsync).not.toHaveBeenCalledWith(
      "/tmp/test-repo",
      ["reset", "--hard", hash],
    );
  });
});
