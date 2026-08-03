import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
}));

import { runGitRepoAsync } from "@/lib/git/repo-local";
import { materializeGitRevisionFile } from "./open-at-revision";

describe("materializeGitRevisionFile", () => {
  const tmp = path.join(os.tmpdir(), `devhub-rev-test-${process.pid}`);

  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects path traversal", async () => {
    const result = await materializeGitRevisionFile("/repo", "r", "abc1234", "../etc/passwd");
    expect(result).toEqual({ error: "Invalid path" });
    expect(runGitRepoAsync).not.toHaveBeenCalled();
  });

  it("accepts a parent-walk ref (Blame previous → Open with Cursor)", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_root, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "def5678\n", stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: "older revision\n", stderr: "" };
      throw new Error(args.join(" "));
    });

    const result = await materializeGitRevisionFile("/repo", "r", "abc1234^", "src/x.ts");
    expect(result).toMatchObject({ shortHash: "def5678" });
  });

  it("writes the blob under the cache layout", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_root, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc1234\n", stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: "hello from commit\n", stderr: "" };
      throw new Error(args.join(" "));
    });

    const result = await materializeGitRevisionFile("/repo", "demo-repo", "aaaaaaaa", "src/x.ts");
    expect(result).toMatchObject({ shortHash: "abc1234" });
    if ("error" in result) throw new Error(result.error);
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("hello from commit\n");
    expect(result.absolutePath).toContain(`${path.sep}demo-repo${path.sep}abc1234${path.sep}src${path.sep}x.ts`);
  });
});
