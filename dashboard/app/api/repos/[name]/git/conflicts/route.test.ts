import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));

vi.mock("@/lib/git/repo-local", () => ({
  runGitRepo: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

vi.mock("@/lib/git/conflicts", () => ({
  deleteConflictFile: vi.fn(() => ({ ok: true })),
  detectConflictOperation: vi.fn(() => "merge"),
  detectGitConflicts: vi.fn(() => []),
  readConflictFileContent: vi.fn(() => ""),
  readConflictSides: vi.fn(() => ({ base: null, ours: null, theirs: null, binary: false })),
  resolveConflictFile: vi.fn(() => ({ ok: true })),
  resolveConflictSide: vi.fn(() => ({ ok: true })),
}));

import { detectGitConflicts, readConflictSides, resolveConflictSide } from "@/lib/git/conflicts";
import { runGitRepo } from "@/lib/git/repo-local";
import { GET, POST } from "./route";

const params = { params: Promise.resolve({ name: "test-repo" }) };

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/repos/test-repo/git/conflicts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/repos/[name]/git/conflicts", () => {
  it("returns the ours/theirs diff used by the split resolver", async () => {
    vi.mocked(detectGitConflicts).mockReturnValue([
      { path: "src/a.ts", source: "unmerged", status: "UU" },
    ]);
    vi.mocked(readConflictSides).mockReturnValue({
      base: "const value = 0;",
      ours: "const value = 1;",
      theirs: "const value = 2;",
      binary: false,
    });
    vi.mocked(runGitRepo).mockReturnValue({
      status: 0,
      stdout: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n",
      stderr: "",
    });

    const response = await GET(new NextRequest("http://test"), params);
    const json = await response.json();

    expect(json.conflicts[0].comparison).toEqual([
      { type: "hunk", text: "@@ -1 +1 @@" },
      { type: "del", text: "-const value = 1;" },
      { type: "add", text: "+const value = 2;" },
      { type: "ctx", text: "" },
    ]);
  });
});

describe("POST /api/repos/[name]/git/conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectGitConflicts).mockReturnValue([]);
  });

  it("continues a resolved merge", async () => {
    const response = await POST(request({ action: "continue" }), params);

    expect(response.status).toBe(200);
    expect(runGitRepo).toHaveBeenCalledWith("/tmp/test-repo", ["commit", "--no-edit"]);
  });

  it("refuses to continue with unresolved files", async () => {
    vi.mocked(detectGitConflicts).mockReturnValue([
      { path: "src/a.ts", source: "unmerged", status: "UU" },
    ]);

    const response = await POST(request({ action: "continue" }), params);

    expect(response.status).toBe(400);
    expect(runGitRepo).not.toHaveBeenCalled();
  });

  it("takes a whole index side", async () => {
    vi.mocked(detectGitConflicts).mockReturnValue([
      { path: "src/a.ts", source: "unmerged", status: "UU" },
    ]);
    const response = await POST(
      request({ action: "take", path: "src/a.ts", side: "theirs" }),
      params,
    );

    expect(response.status).toBe(200);
    expect(resolveConflictSide).toHaveBeenCalledWith("/tmp/test-repo", "src/a.ts", "theirs");
  });

  it("rejects paths that are not active conflicts", async () => {
    const response = await POST(
      request({ action: "resolve", path: ".git/config", content: "owned" }),
      params,
    );

    expect(response.status).toBe(400);
  });
});
