import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepo: vi.fn(),
  runGitRepoAsync: vi.fn(),
  resolveDefaultRemoteBranch: vi.fn(async () => "origin/main"),
  readOriginRemoteUrl: vi.fn(() => null),
  readRemoteUrl: vi.fn(() => null),
  remoteWebUrl: vi.fn(() => null),
}));

import { resolveDefaultRemoteBranch, runGitRepo, runGitRepoAsync } from "@/lib/git/repo-local";
import { GET, POST } from "./route";
import {
  isSafeBranchName,
  parseChangedFiles,
  parseLeftRightCount,
  parseUnpushedCommits,
} from "./parsers";

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

describe("GET /api/repos/[name]/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runGitRepo).mockReturnValue({ status: 0, stdout: "main\n", stderr: "" });
  });

  it("lists fetched remote branches and their tracking local branch", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command.startsWith("branch --list")) {
        return {
          status: 0,
          stdout: "main\0origin/main\0abc1234\nreview\0origin/feature/review\0def5678\n",
          stderr: "",
        };
      }
      if (command.startsWith("branch --remotes")) {
        return {
          status: 0,
          stdout:
            "origin/HEAD\0abc1234\norigin/main\0abc1234\norigin/feature/review\0def5678\nfork/feature/other\x009999999\n",
          stderr: "",
        };
      }
      if (command === "stash list" || command === "status --porcelain") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return { status: 0, stdout: "origin/main\n", stderr: "" };
      }
      if (args[0] === "log") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { status: 0, stdout: "0 0\n", stderr: "" };
      if (command === "remote -v") {
        return {
          status: 0,
          stdout: [
            "origin\tgit@github.com:org/repo.git (fetch)",
            "origin\tgit@github.com:org/repo.git (push)",
            "fork\tgit@github.com:me/repo.git (fetch)",
            "fork\tgit@github.com:me/repo.git (push)",
          ].join("\n"),
          stderr: "",
        };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/branches"),
      params,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      remoteBranches: [
        {
          name: "origin/main",
          remote: "origin",
          localName: "main",
          trackedLocalName: "main",
        },
        {
          name: "origin/feature/review",
          trackedLocalName: "review",
        },
        {
          name: "fork/feature/other",
          remote: "fork",
          localName: "feature/other",
          trackedLocalName: null,
        },
      ],
    });
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

  it("stashes dirty work, syncs with main, pushes, then restores the stash", async () => {
    vi.mocked(resolveDefaultRemoteBranch).mockResolvedValue("origin/main");
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      const outputs: Record<string, string> = {
        "rev-parse --abbrev-ref HEAD": "feature/foo\n",
        "status --porcelain": " M src/a.ts\n",
        "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/feature/foo\n",
      };
      if (command in outputs) return { status: 0, stdout: outputs[command]!, stderr: "" };
      if (["stash", "fetch", "merge", "push"].includes(args[0]!)) return { status: 0, stdout: "ok\n", stderr: "" };
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "sync-main" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, mainBranch: "origin/main", stashed: true });
    expect(resolveDefaultRemoteBranch).toHaveBeenCalledWith("/tmp/test-repo");
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", ["stash", "pop", "stash@{0}"]);
  });

  it("sets the upstream when pushing a branch that has never been pushed", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      // No upstream: git exits non-zero for `rev-parse @{u}`.
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return { status: 128, stdout: "", stderr: "fatal: no upstream configured\n" };
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/new\n", stderr: "" };
      }
      if (args[0] === "push") return { status: 0, stdout: "", stderr: "" };
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "push" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      setUpstream: true,
      branch: "feature/new",
    });
    expect(runGitRepoAsync).toHaveBeenCalledWith(
      "/tmp/test-repo",
      ["push", "--set-upstream", "origin", "feature/new"],
      { timeout: 300_000 },
    );
  });

  it("checks out a fetched remote branch as a tracking local branch", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "show-ref --verify --quiet refs/remotes/origin/feature/review") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "status --porcelain") return { status: 0, stdout: "", stderr: "" };
      if (command === "checkout --track -b review origin/feature/review") {
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(
      request({
        action: "checkout-remote",
        branch: "origin/feature/review",
        newBranch: "review",
      }),
      params,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, branch: "review" });
  });

  it("pushes plainly when the branch already tracks an upstream", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return { status: 0, stdout: "origin/feature/old\n", stderr: "" };
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/old\n", stderr: "" };
      }
      if (args[0] === "push") return { status: 0, stdout: "", stderr: "" };
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "push" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, setUpstream: false });
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/test-repo", ["push"], { timeout: 300_000 });
  });

  it("force-pushes a tracked branch with a lease", async () => {
    const expectedOid = "f".repeat(40);
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return { status: 0, stdout: "origin/feature/rebased\n", stderr: "" };
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/rebased\n", stderr: "" };
      }
      if (command === "rev-parse origin/feature/rebased") {
        return { status: 0, stdout: `${expectedOid}\n`, stderr: "" };
      }
      if (command === "config --get branch.feature/rebased.remote") {
        return { status: 0, stdout: "origin\n", stderr: "" };
      }
      if (command === "config --get branch.feature/rebased.merge") {
        return { status: 0, stdout: "refs/heads/feature/rebased\n", stderr: "" };
      }
      if (args[0] === "push") {
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "force-push-with-lease" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      branch: "feature/rebased",
      upstream: "origin/feature/rebased",
    });
    expect(runGitRepoAsync).toHaveBeenCalledWith(
      "/tmp/test-repo",
      [
        "push",
        `--force-with-lease=refs/heads/feature/rebased:${expectedOid}`,
        "origin",
        "HEAD:refs/heads/feature/rebased",
      ],
      { timeout: 300_000 },
    );
  });

  it("explains a rejected push instead of echoing git's diagnostics", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return { status: 0, stdout: "origin/feature/old\n", stderr: "" };
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/old\n", stderr: "" };
      }
      if (args[0] === "push") {
        return {
          status: 1,
          stdout: "",
          stderr: "! [rejected] feature/old -> feature/old (non-fast-forward)\n",
        };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "push" }), params);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/pull \(or sync\) first/i),
    });
  });

  it("refuses to merge a branch into a dirty working tree", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/mine\n", stderr: "" };
      }
      if (command === "status --porcelain") return { status: 0, stdout: " M src/a.ts\n", stderr: "" };
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "merge-branch", branch: "feature/theirs" }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/commit or stash/i),
    });
    expect(runGitRepoAsync).not.toHaveBeenCalledWith("/tmp/test-repo", expect.arrayContaining(["merge"]), expect.anything());
  });

  it("aborts a conflicting rebase and points at the backup branch", async () => {
    const calls: string[] = [];
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      calls.push(command);
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/mine\n", stderr: "" };
      }
      if (command === "status --porcelain") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "branch") return { status: 0, stdout: "", stderr: "" };
      if (command.startsWith("rebase --abort")) return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "rebase") {
        return { status: 1, stdout: "", stderr: "CONFLICT (content): Merge conflict in src/a.ts\n" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(request({ action: "rebase-branch", branch: "main" }), params);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/rebase aborted/i),
      backupBranch: expect.stringMatching(/^devhub\/backup-/),
    });
    expect(calls).toContain("rebase --abort");
  });

  it("rejects branch names that could turn into git flags or ranges", async () => {
    for (const branch of ["--force", "a..b", "feature/ok name", "", "refs/"]) {
      const response = await POST(request({ action: "merge-branch", branch }), params);
      expect(response.status).toBe(400);
    }
    expect(runGitRepoAsync).not.toHaveBeenCalled();
  });

  it("refuses a hard reset that would discard uncommitted work", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feature/mine\n", stderr: "" };
      }
      if (command === "status --porcelain") return { status: 0, stdout: "?? new.ts\n", stderr: "" };
      throw new Error(`Unexpected git command: ${command}`);
    });

    const response = await POST(
      request({ action: "reset-to-branch", branch: "main", mode: "hard" }),
      params,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/would delete those changes/i),
    });
  });
});

describe("isSafeBranchName", () => {
  it("accepts the branch shapes teams actually use", () => {
    for (const branch of ["main", "feature/PTF-4484_thing", "release-1.2.3", "a/b/c"]) {
      expect(isSafeBranchName(branch)).toBe(true);
    }
  });

  it("rejects anything that could be re-read as a flag, a range or extra argv", () => {
    for (const branch of [
      "-D",
      "--force",
      "a..b",
      "with space",
      "trailing/",
      "/leading",
      "ends.lock",
      "ends.",
      "nul\0byte",
      "",
      123,
      null,
    ]) {
      expect(isSafeBranchName(branch)).toBe(false);
    }
  });
});
