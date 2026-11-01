import { beforeEach, expect, it, vi } from "vitest";
import { GET as files } from "./files/route";
import { GET as people } from "./people/route";
import { GET as branchPrs } from "./branch-prs/route";
import { GET as reflog } from "./reflog/route";
import { POST as changeRemote } from "./remotes/route";
import { POST as commitAction } from "./commit-action/route";
import { POST as rebaseInteractive } from "./rebase-interactive/route";
import { POST as commitMessage } from "./commit-message/route";
import { POST as stashMessage } from "./stash-message/route";
import { GET as coupling } from "./coupling/route";
import { GET as commitContext } from "./commit-context/route";
import { runGitRepoAsync } from "../../../../../lib/git/repo-local";
import { withRepoGitMutation } from "../../../../../lib/git/mutation-queue";

vi.mock("./_shared", () => ({
  withScannedRepo: (name: string) => name === "missing"
    ? { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) }
    : { ok: true, repoRoot: "/fixture/repo" },
  gitFail: () => Response.json({ error: "failed" }, { status: 500 }),
}));
vi.mock("../../../../../lib/git/repo-local", () => ({ runGitRepoAsync: vi.fn().mockResolvedValue({ status: 0, stdout: "a.ts\0b.ts\0" }) }));
vi.mock("../../../../../lib/people/repo-people", () => ({ loadRepoPeople: vi.fn().mockResolvedValue({ people: [], byEmail: {}, githubConfigured: false }) }));
vi.mock("../../../../../lib/gh-exec", () => ({ isGithubCliAuthenticated: vi.fn().mockResolvedValue(false), execGh: vi.fn(), mapGithubCliError: vi.fn() }));
vi.mock("../../../../../lib/git/mutation-queue", () => ({ withRepoGitMutation: vi.fn(async (_repo: string, action: () => Promise<unknown>) => action()) }));
vi.mock("../../../../../lib/repos/change-impact", () => ({ analyzeChangeImpact: vi.fn().mockResolvedValue({ companions: [], commitsAnalysed: 2, domains: [], reviewers: [] }) }));
vi.mock("../../../../../lib/notes/review-index-server", () => ({ getReviewNoteIndex: vi.fn().mockReturnValue([]) }));
vi.mock("../../../../../lib/notes/review-index", () => ({ matchReviewNotes: vi.fn().mockReturnValue([]) }));
vi.mock("../../../../../lib/recall/store", () => ({ loadIndex: vi.fn().mockReturnValue(null) }));
beforeEach(() => vi.clearAllMocks());

it("keeps repository lookup and dashboard Git views unchanged", async () => {
  const req = new Request("http://localhost:1447/api/repos/demo/git/files");
  const params = { params: Promise.resolve({ name: "demo" }) };
  expect(await (await files(req, params)).json()).toEqual({ files: ["a.ts", "b.ts"] });
  expect(await (await people(req, params)).json()).toEqual({ people: [], emailIndex: {}, githubConfigured: false });
  expect(await (await branchPrs(req, params)).json()).toMatchObject({ configured: false, prs: [] });
  const missing = { params: Promise.resolve({ name: "missing" }) };
  for (const action of [files, people, branchPrs]) expect((await action(req, missing)).status).toBe(404);
});

it("clamps reflog limits and still resolves the requested repository", async () => {
  const params = { params: Promise.resolve({ name: "demo" }) };
  const req = new Request("http://localhost:1447/api/repos/demo/git/reflog?limit=900");
  expect((await reflog(req, params)).status).toBe(200);
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo", expect.arrayContaining(["--max-count=500"]));
  const missing = { params: Promise.resolve({ name: "missing" }) };
  expect((await reflog(req, missing)).status).toBe(404);
});

it("rejects unsafe remote arguments before running Git", async () => {
  const base = "http://localhost:1447/api/repos/demo/git/remotes";
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (body: object) => new Request(base, { method: "POST", body: JSON.stringify(body) });
  expect((await changeRemote(request({ action: "remove", name: "-option" }), params)).status).toBe(400);
  expect((await changeRemote(request({ action: "add", name: "origin", url: "-option" }), params)).status).toBe(400);
  expect(runGitRepoAsync).not.toHaveBeenCalled();
  expect(await (await changeRemote(request({ action: "remove", name: "old" }), params)).json()).toEqual({ ok: true });
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo", ["remote", "remove", "old"]);
});

it("keeps commit actions queued and rejects unsafe revisions", async () => {
  const base = "http://localhost:1447/api/repos/demo/git/commit-action";
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (body: object) => new Request(base, { method: "POST", body: JSON.stringify(body) });
  expect((await commitAction(request({ action: "tag", commit: "--bad", name: "v1" }), params)).status).toBe(400);
  expect(withRepoGitMutation).toHaveBeenCalledOnce();
  expect(runGitRepoAsync).not.toHaveBeenCalled();
  expect((await commitAction(request({ action: "tag", commit: "abcd1234", name: "v1" }), params)).status).toBe(200);
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo", ["tag", "v1", "abcd1234"]);
});

it("rejects unsafe interactive rebase plans before running Git", async () => {
  const base = "http://localhost:1447/api/repos/demo/git/rebase-interactive";
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (body: object) => new Request(base, { method: "POST", body: JSON.stringify(body) });
  const steps = [{ commit: "abcdef1", op: "pick" }];
  expect((await rebaseInteractive(request({ base: "-badbad", steps }), params)).status).toBe(400);
  expect((await rebaseInteractive(request({ base: "abcdef0", steps: [{ commit: "-badbad", op: "pick" }] }), params)).status).toBe(400);
  expect(runGitRepoAsync).not.toHaveBeenCalled();
});

it("retains commit and stash suggestion diff selection", async () => {
  vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "", stderr: "" } as Awaited<ReturnType<typeof runGitRepoAsync>>);
  const base = "http://localhost:1447/api/repos/demo/git";
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (path: string, body: object) => new Request(`${base}/${path}`, { method: "POST", body: JSON.stringify(body) });
  expect((await commitMessage(request("commit-message", { stagedOnly: false }), params)).status).toBe(400);
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo", ["diff", "HEAD"]);
  expect((await commitMessage(request("commit-message", { stagedOnly: "false" }), params)).status).toBe(400);
  expect(runGitRepoAsync).toHaveBeenCalledWith("/fixture/repo", ["diff", "--cached"]);
  expect((await stashMessage(request("stash-message", {}), params)).status).toBe(400);
});

it("preserves path guards and no-store headers in Git context views", async () => {
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (query: string) => new Request(`http://localhost:1447/api/repos/demo/git/context?${query}`);
  expect(await (await coupling(request("paths=../secret"), params)).json()).toEqual({ suggestions: [], commitsAnalysed: 0, domains: [], reviewers: [] });
  expect((await coupling(request("paths=src%2Fapp.ts"), params)).headers.get("cache-control")).toBe("no-store");
  expect((await commitContext(request("commit=--bad"), params)).status).toBe(400);
  expect((await commitContext(request("commit=HEAD"), params)).headers.get("cache-control")).toBe("no-store");
  const missing = { params: Promise.resolve({ name: "missing" }) };
  expect((await commitContext(request("commit=--bad"), missing)).status).toBe(404);
});
