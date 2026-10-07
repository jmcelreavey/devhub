import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({ git: vi.fn(), inspect: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/repos/worktree-merge", () => ({ loadMergedWorktreePrs: async () => ({ prs: [] }) }));
vi.mock("../git/_shared", () => ({ withScannedRepo: () => ({ ok: true, repoRoot: "/repo" }) }));
vi.mock("@/lib/api-utils", async (original) => ({ ...await original<typeof import("@/lib/api-utils")>(), requireDashboardAuth: mocks.auth }));
vi.mock("@/lib/git/repo-local", () => ({ runGitRepoAsync: mocks.git }));
vi.mock("@/lib/repos/worktree-inventory", () => ({
  worktreeInventory: vi.fn(), loadWorktreeContext: () => ({}), describeWorktree: (tree: unknown) => tree, inspectWorktree: mocks.inspect,
}));
const head = "a".repeat(40);
function request(overrides = {}) {
  return new NextRequest("http://localhost/api/repos/demo/worktrees", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries: [{ path: "/repo/.git/devhub-worktrees/feature", head }], confirmed: true, ...overrides }),
  });
}
const params = { params: Promise.resolve({ name: "demo" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ ok: true });
  mocks.git.mockImplementation(async (_root, args: string[]) => args[1] === "list" ? {
    status: 0, stdout: `worktree /repo\nHEAD ${head}\nbranch refs/heads/main\n\nworktree /repo/.git/devhub-worktrees/feature\nHEAD ${head}\nbranch refs/heads/feature\n`, stderr: "",
  } : { status: 0, stdout: "", stderr: "" });
  mocks.inspect.mockResolvedValue({ details: { blockers: [], ignoredPaths: [] } });
});
describe("reviewed worktree removal", () => {
  it("requires fresh merge evidence for merged cleanup", async () => {
    mocks.inspect.mockResolvedValue({ merge: { verified: false, reason: "Checkout has newer commits" }, details: { blockers: [], ignoredPaths: [] } });
    const result = await (await POST(request({ mergedOnly: true }), params)).json();
    expect(result.removed).toEqual([]);
    expect(result.errors[0].error).toBe("Checkout has newer commits");
    expect(mocks.git).toHaveBeenCalledTimes(1);
  });
  it("removes a verified squash merge even after its remote branch was deleted", async () => {
    mocks.inspect.mockResolvedValue({ merge: { verified: true }, details: { blockers: [], unpushedCount: 3, ignoredPaths: [] } });
    const result = await (await POST(request({ mergedOnly: true }), params)).json();
    expect(result.removed).toEqual(["/repo/.git/devhub-worktrees/feature"]);
    expect(mocks.git).toHaveBeenLastCalledWith("/repo", ["worktree", "remove", "--", "/repo/.git/devhub-worktrees/feature"], expect.anything());
  });
  it("catches commits created during the slow inspection", async () => {
    mocks.inspect.mockImplementation(async () => {
      mocks.git.mockResolvedValue({ status: 0, stdout: `worktree /repo\nHEAD ${head}\nbranch refs/heads/main\n\nworktree /repo/.git/devhub-worktrees/feature\nHEAD ${"b".repeat(40)}\nbranch refs/heads/feature\n`, stderr: "" });
      return { details: { blockers: [], ignoredPaths: [] } };
    });
    const result = await (await POST(request(), params)).json();
    expect(result.removed).toEqual([]);
    expect(result.errors[0].error).toContain("changed during review");
    expect(mocks.git).toHaveBeenCalledTimes(2);
  });
  it("rejects the main checkout independently of inspection", async () => {
    const result = await (await POST(request({ entries: [{ path: "/repo", head }] }), params)).json();
    expect(result.removed).toEqual([]);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("requires authentication and explicit confirmation", async () => {
    expect((await POST(request({ confirmed: false }), params)).status).toBe(400);
    mocks.auth.mockReturnValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.git).not.toHaveBeenCalled();
  });
  it.each(["/outside", "/repo/.git/devhub-worktrees/missing"])("rejects a path absent from Git: %s", async (path) => {
    const response = await POST(request({ entries: [{ path, head }] }), params);
    expect((await response.json()).errors[0].error).toContain("changed since preview");
    expect(mocks.git).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed HEAD", async () => {
    const response = await POST(request({ entries: [{ path: "/repo/.git/devhub-worktrees/feature", head: "b".repeat(40) }] }), params);
    expect((await response.json()).removed).toEqual([]);
    expect(mocks.git).toHaveBeenCalledTimes(1);
  });
  it("rechecks safety rather than trusting the preview", async () => {
    mocks.inspect.mockResolvedValue({ details: { blockers: ["Agent run still active"], ignoredPaths: [] } });
    const response = await POST(request(), params);
    expect((await response.json()).errors[0].error).toContain("Agent run still active");
    expect(mocks.git).toHaveBeenCalledTimes(1);
  });
  it("requires acknowledgment of ignored files and never forces deletion", async () => {
    mocks.inspect.mockResolvedValue({ details: { blockers: [], ignoredPaths: [".env"] } });
    expect((await (await POST(request(), params)).json()).removed).toEqual([]);
    const response = await POST(request({ includeIgnored: true }), params);
    expect((await response.json()).removed).toEqual(["/repo/.git/devhub-worktrees/feature"]);
    expect(mocks.git).toHaveBeenLastCalledWith("/repo", ["worktree", "remove", "--", "/repo/.git/devhub-worktrees/feature"], expect.anything());
  });
});
