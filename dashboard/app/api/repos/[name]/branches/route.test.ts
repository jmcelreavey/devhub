import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git-repo-local", () => ({
  runGitRepo: vi.fn(),
  runGitRepoAsync: vi.fn(),
}));

import { runGitRepoAsync } from "@/lib/git-repo-local";
import { POST } from "./route";
import { parseChangedFiles, parseLeftRightCount, parseUnpushedCommits } from "./parsers";

const params = { params: Promise.resolve({ name: "test-repo" }) };

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/test-repo/branches", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("repo branch route parsers", () => {
  it("parses changed files from porcelain status", () => {
    expect(parseChangedFiles(" M dashboard/app/repos/cards.tsx\n?? new file.txt\n")).toEqual([
      { status: "M", path: "dashboard/app/repos/cards.tsx" },
      { status: "??", path: "new file.txt" },
    ]);
  });

  it("parses unpushed commits with full + short hash", () => {
    expect(
      parseUnpushedCommits(
        "\u001eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u0000abc1234\u0000add repo actions\nfile-a.ts\nfile-b.ts\n",
      ),
    ).toEqual([
      {
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        shortHash: "abc1234",
        subject: "add repo actions",
        files: ["file-a.ts", "file-b.ts"],
      },
    ]);
  });

  it("parses legacy short-hash unpushed format", () => {
    expect(parseUnpushedCommits("\u001eabc123\u0000add repo actions\nfile-a.ts\n")).toEqual([
      { hash: "abc123", shortHash: "abc123", subject: "add repo actions", files: ["file-a.ts"] },
    ]);
  });

  it("parses left-right rev-list counts", () => {
    expect(parseLeftRightCount("2\t5\n")).toEqual({ left: 2, right: 5 });
    expect(parseLeftRightCount("0 1")).toEqual({ left: 0, right: 1 });
  });
});

describe("POST /api/repos/[name]/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to commit when nothing is staged without staging the working tree", async () => {
    vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "", stderr: "" });

    const response = await POST(request({ action: "commit", message: "fix: safe commit" }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/nothing is staged/i),
    });
    expect(runGitRepoAsync).toHaveBeenCalledTimes(1);
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", [
      "diff",
      "--cached",
      "--name-only",
    ]);
  });

  it("returns an index-lock conflict if the lock appears while committing", async () => {
    vi.mocked(runGitRepoAsync)
      .mockResolvedValueOnce({ status: 0, stdout: "staged.txt\n", stderr: "" })
      .mockResolvedValueOnce({
        status: 1,
        stdout: "",
        stderr: "fatal: Unable to create '/tmp/test-repo/.git/index.lock': File exists.",
      });

    const response = await POST(request({ action: "commit", message: "fix: safe commit" }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "index_lock",
      error: expect.stringMatching(/index\.lock/i),
    });
    expect(runGitRepoAsync).toHaveBeenNthCalledWith(2, "/tmp/test-repo", [
      "commit",
      "-m",
      "fix: safe commit",
    ]);
  });

  it("always contacts the upstream remote when pulling", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "origin/main\n", stderr: "" };
      }
      if (args[0] === "pull") {
        return { status: 0, stdout: "Already up to date.\n", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const response = await POST(request({ action: "pull" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, alreadyUpToDate: true });
    expect(runGitRepoAsync).toHaveBeenCalledWith(
      "/tmp/test-repo",
      ["pull", "--ff-only"],
      { timeout: 120_000 },
    );
  });
});
