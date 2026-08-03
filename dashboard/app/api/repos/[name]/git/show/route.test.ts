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

describe("GET /api/repos/[name]/git/show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts ref as a backward-compatible commit alias", async () => {
    const hash = "a".repeat(40);
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "show") {
        return {
          status: 0,
          stdout: [
            hash,
            hash.slice(0, 7),
            "subject",
            "",
            "Test",
            "test@example.com",
            "2026-07-17",
            "now",
            "",
          ].join("\0"),
          stderr: "",
        };
      }
      if (args[0] === "diff-tree") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${hash}\n`, stderr: "" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const request = new NextRequest("http://test/api/repos/test-repo/git/show?ref=HEAD");
    const response = await GET(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ hash, subject: "subject", isHead: true });
  });

  it("passes -U context for path diffs and returns context", async () => {
    const hash = "b".repeat(40);
    const showCalls: string[][] = [];
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "show" && args.includes("-s")) {
        return {
          status: 0,
          stdout: [
            hash,
            hash.slice(0, 7),
            "subject",
            "",
            "Test",
            "test@example.com",
            "2026-07-17",
            "now",
            "",
          ].join("\0"),
          stderr: "",
        };
      }
      if (args[0] === "show" && args.includes("--patch")) {
        showCalls.push([...args]);
        return {
          status: 0,
          stdout: "diff --git a/a.ts b/a.ts\n@@ -1,3 +1,4 @@\n context\n+added\n",
          stderr: "",
        };
      }
      if (args[0] === "diff-tree") {
        return { status: 0, stdout: "M\ta.ts\n", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${hash}\n`, stderr: "" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const request = new NextRequest(
      "http://test/api/repos/test-repo/git/show?commit=" + hash + "&path=a.ts&context=20",
    );
    const response = await GET(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.context).toBe(20);
    expect(showCalls[0]).toContain("-U20");
  });

  it("full=1 requests whole-file context", async () => {
    const hash = "c".repeat(40);
    const showCalls: string[][] = [];
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "show" && args.includes("-s")) {
        return {
          status: 0,
          stdout: [
            hash,
            hash.slice(0, 7),
            "subject",
            "",
            "Test",
            "test@example.com",
            "2026-07-17",
            "now",
            "",
          ].join("\0"),
          stderr: "",
        };
      }
      if (args[0] === "show" && args.includes("--patch")) {
        showCalls.push([...args]);
        return { status: 0, stdout: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n+x\n", stderr: "" };
      }
      if (args[0] === "diff-tree") {
        return { status: 0, stdout: "M\ta.ts\n", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${hash}\n`, stderr: "" };
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const request = new NextRequest(
      "http://test/api/repos/test-repo/git/show?commit=" + hash + "&path=a.ts&full=1",
    );
    const response = await GET(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.context).toBe(999_999);
    expect(showCalls[0]).toContain("-U999999");
  });
});
