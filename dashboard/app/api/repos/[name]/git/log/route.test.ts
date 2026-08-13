import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
  resolveDefaultRemoteBranch: vi.fn(async () => "origin/main"),
}));

import { runGitRepoAsync } from "@/lib/git/repo-local";
import { GET } from "./route";

const params = { params: Promise.resolve({ name: "test-repo" }) };

/** Record and field separators from the `--format` the route asks git for. */
const RS = String.fromCharCode(30);
const NUL = String.fromCharCode(0);

describe("GET /api/repos/[name]/git/log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * A linear chain of `count` commits, newest first, as git log would emit it.
   * With `terminate`, the oldest is a root; otherwise it points at a parent
   * outside the page, which is what leaves an open frontier.
   */
  function chain(count: number, terminate = false): string {
    return Array.from({ length: count }, (_, index) => {
      const hash = String(index + 1).repeat(40);
      const last = index === count - 1;
      const parent = last && terminate ? "" : String(index + 2).repeat(40);
      return (
        RS +
        [hash, parent, hash.slice(0, 7), `subject ${index}`, "Test", "now", ""].join(NUL)
      );
    }).join("");
  }

  function mockGit(logStdout: string) {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "feature/test\n", stderr: "" };
      if (args[0] === "log") return { status: 0, stdout: logStdout, stderr: "" };
      if (args[0] === "rev-list") return { status: 0, stdout: "0 1\n", stderr: "" };
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });
  }

  function logArgs(): string[] {
    const call = vi.mocked(runGitRepoAsync).mock.calls.find(([, args]) => args[0] === "log");
    if (!call) throw new Error("git log was never called");
    return call[1];
  }

  it("pages from the open frontier rather than an offset", async () => {
    mockGit(chain(6));

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?limit=5"),
      params,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    // The sixth commit is trimmed from the page, so its hash is the frontier the
    // next page walks from. `--skip` cannot express this once the walk covers
    // more than one tip, and every walk here now does.
    expect(json).toMatchObject({
      count: 5,
      hasMore: true,
      nextTips: ["6".repeat(40)],
    });
    // Null rather than absent: the field is always present and says which
    // cursor style applies, so the client never has to guess.
    expect(json.nextOffset).toBeNull();
    expect(json.commits[0]).toMatchObject({ parents: ["2".repeat(40)] });
    expect(logArgs()).toEqual(expect.arrayContaining(["--max-count=6"]));
    expect(logArgs()).not.toEqual(
      expect.arrayContaining([expect.stringContaining("--skip")]),
    );
  });

  it("reports no more pages once the walk reaches a root", async () => {
    mockGit(chain(3, true));

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?limit=5"),
      params,
    );

    const json = await response.json();
    expect(json).toMatchObject({ count: 3, hasMore: false, nextTips: [] });
  });

  it("walks every ref by default so side branches get their own lanes", async () => {
    mockGit(chain(2, true));

    await GET(new NextRequest("http://test/api/repos/test-repo/git/log"), params);

    const args = logArgs();
    expect(args).toEqual(expect.arrayContaining(["--branches", "--remotes", "--tags"]));
    // Date order keeps rows in reading order while still never placing a parent
    // above its child, which the lane assignment depends on.
    expect(args).toEqual(expect.arrayContaining(["--date-order"]));
  });

  it("walks only HEAD and the default remote tip under scope=current", async () => {
    mockGit(chain(2, true));

    await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?scope=current"),
      params,
    );

    const args = logArgs();
    expect(args).toEqual(expect.arrayContaining(["HEAD", "origin/main"]));
    expect(args).not.toEqual(expect.arrayContaining(["--branches"]));
  });

  it("continues from supplied tips", async () => {
    mockGit(chain(2, true));
    const tip = "a".repeat(40);

    await GET(
      new NextRequest(`http://test/api/repos/test-repo/git/log?tips=${tip}`),
      params,
    );

    const args = logArgs();
    expect(args).toEqual(expect.arrayContaining([tip]));
    // A continuation walks the frontier alone — re-adding every ref would just
    // return the first page again.
    expect(args).not.toEqual(expect.arrayContaining(["--branches"]));
  });

  it("pushes a message search down to git log", async () => {
    mockGit(chain(2, true));

    await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?q=PTF-4356"),
      params,
    );

    const args = logArgs();
    // Fixed-strings so a query with regex metacharacters searches for itself
    // rather than being interpreted.
    expect(args).toEqual(expect.arrayContaining(["--grep=PTF-4356", "--fixed-strings"]));
    expect(args).toEqual(expect.arrayContaining(["--regexp-ignore-case"]));
  });

  it("pages a filtered walk by offset, not by the frontier", async () => {
    // The parent of a matching commit is usually not itself a match, so the
    // open frontier is neither the next results nor a bounded set.
    mockGit(chain(6));

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?limit=5&q=fix"),
      params,
    );

    const json = await response.json();
    expect(json).toMatchObject({ searching: true, hasMore: true, nextOffset: 5, nextTips: [] });
  });

  it("carries the offset back into the walk", async () => {
    mockGit(chain(2, true));

    await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?q=fix&offset=40"),
      params,
    );

    expect(logArgs()).toEqual(expect.arrayContaining(["--skip=40"]));
  });

  it("pages an unfiltered walk by the frontier, with no offset", async () => {
    mockGit(chain(6));

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?limit=5"),
      params,
    );

    const json = await response.json();
    expect(json).toMatchObject({ searching: false, nextOffset: null });
    expect(json.nextTips).toEqual(["6".repeat(40)]);
  });

  it("ORs repeated author filters so one person's addresses all match", async () => {
    mockGit(chain(2, true));

    await GET(
      new NextRequest(
        "http://test/api/repos/test-repo/git/log?author=a%40work.com&author=a%40home.com",
      ),
      params,
    );

    expect(logArgs()).toEqual(
      expect.arrayContaining(["--author=a@work.com", "--author=a@home.com"]),
    );
  });

  it("treats a hash-shaped query as a jump rather than a text search", async () => {
    const sha = "1".repeat(40);
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return { status: 0, stdout: `${sha}\n`, stderr: "" };
      }
      if (args[0] === "rev-parse") return { status: 0, stdout: "feature/test\n", stderr: "" };
      if (args[0] === "log") return { status: 0, stdout: chain(1, true), stderr: "" };
      if (args[0] === "rev-list") return { status: 0, stdout: "0 1\n", stderr: "" };
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    const response = await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?q=1111111"),
      params,
    );

    const args = logArgs();
    // --grep would never match: the hash is not in the message.
    expect(args).toEqual(expect.arrayContaining([sha, "--max-count=1"]));
    expect(args).not.toEqual(expect.arrayContaining([expect.stringContaining("--grep")]));
    expect(await response.json()).toMatchObject({ directHit: true, searching: true });
  });

  it("falls back to a text search when a hex-looking query resolves to nothing", async () => {
    vi.mocked(runGitRepoAsync).mockImplementation(async (_repoRoot, args) => {
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return { status: 128, stdout: "", stderr: "unknown revision" };
      }
      if (args[0] === "rev-parse") return { status: 0, stdout: "feature/test\n", stderr: "" };
      if (args[0] === "log") return { status: 0, stdout: chain(1, true), stderr: "" };
      if (args[0] === "rev-list") return { status: 0, stdout: "0 1\n", stderr: "" };
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    });

    await GET(new NextRequest("http://test/api/repos/test-repo/git/log?q=deadbee"), params);
    expect(logArgs()).toEqual(expect.arrayContaining(["--grep=deadbee"]));
  });

  it("does not spend a subprocess resolving an ordinary word", async () => {
    mockGit(chain(2, true));

    await GET(new NextRequest("http://test/api/repos/test-repo/git/log?q=migrate"), params);

    const verifies = vi
      .mocked(runGitRepoAsync)
      .mock.calls.filter(([, args]) => args[0] === "rev-parse" && args[1] === "--verify");
    expect(verifies).toHaveLength(0);
  });

  it("drops anything in tips that is not a hash", async () => {
    mockGit(chain(2, true));

    await GET(
      new NextRequest("http://test/api/repos/test-repo/git/log?tips=--output=/tmp/x,HEAD,zzz"),
      params,
    );

    const args = logArgs();
    expect(args).not.toEqual(expect.arrayContaining(["--output=/tmp/x"]));
    expect(args).not.toEqual(expect.arrayContaining(["zzz"]));
    // Nothing survived validation, so this falls back to a first-page walk
    // rather than running a bare `git log` with no revisions at all.
    expect(args).toEqual(expect.arrayContaining(["--branches"]));
  });
});
