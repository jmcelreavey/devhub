import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { stageDiffHunk } from "../../../../../../lib/git/patch-stage";
import { withRepoGitMutation } from "../../../../../../lib/git/mutation-queue";

vi.mock("../../../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: () => "/fixture/repo-one" }));
vi.mock("../../../../../../lib/git/patch-stage", () => ({ stageDiffHunk: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../../../../../lib/git/mutation-queue", () => ({
  withRepoGitMutation: vi.fn(async (_repo: string, mutate: () => Promise<unknown>) => mutate()),
}));

it("keeps dashboard hunk selection queued and rejects escaping paths", async () => {
  const params = { params: Promise.resolve({ name: "repo-one" }) };
  const request = (path: string) => new Request("http://localhost:1447/api/repos/repo-one/git/stage", {
    method: "POST",
    body: JSON.stringify({ action: "stage-hunk", path, rawDiff: "diff", hunkIndex: 0, lineIndexes: [1.5, 2] }),
  });
  expect((await POST(request("../outside"), params)).status).toBe(400);
  expect(withRepoGitMutation).not.toHaveBeenCalled();
  expect((await POST(request("file.txt"), params)).status).toBe(200);
  expect(withRepoGitMutation).toHaveBeenCalledOnce();
  expect(stageDiffHunk).toHaveBeenCalledWith(expect.objectContaining({ filePath: "file.txt", lineIndexes: [1.5, 2] }));
});
