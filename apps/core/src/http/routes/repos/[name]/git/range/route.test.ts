import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";

vi.mock("../../../../../../lib/repos/scanned-repo", () => ({
  resolveScannedRepo: (name: string) => name === "missing" ? null : `/fixture/${name}`,
}));
vi.mock("../../../../../../lib/git/repo-local", () => ({
  resolveDefaultRemoteBranch: vi.fn(),
  runGitRepoAsync: vi.fn().mockResolvedValue({ status: 0, stdout: "fixture patch", stderr: "" }),
}));

beforeEach(() => vi.clearAllMocks());

it("preserves dashboard range formats and rejects escaped paths before invoking Git", async () => {
  const params = { params: Promise.resolve({ name: "repo-one" }) };
  const request = (query: string) => new Request(`http://localhost:1447/api/repos/repo-one/git/range?${query}`);
  const patch = await GET(request("base=main&head=HEAD&format=patch"), params);
  expect(await patch.json()).toEqual({ base: "main", head: "HEAD", patch: "fixture patch" });
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo-one", ["diff", "main...HEAD"], expect.anything());

  vi.clearAllMocks();
  const escaped = await GET(request("base=main&path=..%2Fsecret&format=patch"), params);
  expect(escaped.status).toBe(400);
  expect(runGitRepoAsync).not.toHaveBeenCalled();
  const missing = { params: Promise.resolve({ name: "missing" }) };
  expect((await GET(request("base=--bad&format=patch"), missing)).status).toBe(404);
});
