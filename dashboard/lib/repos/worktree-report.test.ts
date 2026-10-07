import { beforeEach, expect, it, vi } from "vitest";
import { scanWorktrees } from "./worktree-report";
const mocks = vi.hoisted(() => ({ list: vi.fn(), inventory: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/content/dirs", () => ({ getNotesDir: () => "/notes" }));
vi.mock("@/lib/atomic-write", () => ({ writeAtomic: mocks.write }));
vi.mock("@/lib/repos", () => ({ listRepos: mocks.list }));
vi.mock("./worktree-inventory", () => ({ loadWorktreeContext: () => ({}), worktreeInventory: mocks.inventory }));
beforeEach(() => vi.clearAllMocks());
it("writes a review report once per repository and preserves partial scan failures", async () => {
  mocks.list.mockResolvedValue([
    { name: "app", path: "/app", worktreeCount: 2 },
    { name: "linked", path: "/linked", worktreeOf: "/app", worktreeCount: 2 },
    { name: "missing", path: "/missing", worktreeCount: null },
  ]);
  mocks.inventory.mockResolvedValueOnce({ worktrees: [
    { isMain: true, details: { candidate: false } },
    { isMain: false, details: { candidate: true, sizeBytes: 2048 } },
  ] }).mockRejectedValueOnce(new Error("Cannot inspect"));
  const report = await scanWorktrees(vi.fn());
  expect(mocks.inventory).toHaveBeenCalledTimes(2);
  expect(report.repositories).toEqual([{ name: "app", checkouts: 1, candidates: 1, bytes: 2048, href: "/repos/app/git?tab=worktrees" }]);
  expect(report.errors).toEqual([{ name: "missing", error: "Cannot inspect" }]);
  expect(mocks.write).toHaveBeenCalledWith("/notes/.cache/worktrees/latest.json", JSON.stringify(report, null, 2));
});
