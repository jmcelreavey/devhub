import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { runGitRepoAsync } from "../../../../../lib/git/repo-local";
import { withRepoGitMutation } from "../../../../../lib/git/mutation-queue";

vi.mock("../../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: () => "/fixture/repo-one" }));
vi.mock("../../../../../lib/git/mutation-queue", () => ({
  withRepoGitMutation: vi.fn(async (_repo: string, mutate: () => Promise<unknown>) => mutate()),
}));
vi.mock("../../../../../lib/git/repo-local", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../../lib/git/repo-local")>(),
  runGitRepoAsync: vi.fn().mockResolvedValue({ status: 0, stdout: "", stderr: "" }),
}));

it("keeps dashboard branch mutations queued and rejects unsafe names", async () => {
  const params = { params: Promise.resolve({ name: "repo-one" }) };
  const request = (branch: string) => new Request("http://localhost:1447/api/repos/repo-one/branches", {
    method: "POST",
    body: JSON.stringify({ action: "rename-branch", branch, newBranch: "new-name" }),
  });
  expect((await POST(request("--unsafe"), params)).status).toBe(400);
  expect(withRepoGitMutation).toHaveBeenCalledOnce();
  expect(runGitRepoAsync).not.toHaveBeenCalled();
  expect((await POST(request("old-name"), params)).status).toBe(200);
  expect(withRepoGitMutation).toHaveBeenCalledTimes(2);
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo-one", ["branch", "-m", "old-name", "new-name"]);
});
