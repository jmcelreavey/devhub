import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitAndPushDirty, commitAndPushPaths, pushUnpushedCommits, updateAndSync } from "./orchestrator";

const mocks = vi.hoisted(() => ({ assertPrivate: vi.fn(), git: vi.fn() }));
vi.mock("@/lib/setup/private-repo", () => ({ assertPrivateRepo: mocks.assertPrivate }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ isDesktopRuntime: () => true }));
vi.mock("@/lib/git/repo-local", () => ({ runGitRepo: mocks.git }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEVHUB_CONTENT_ROOT", "/private-content");
  mocks.assertPrivate.mockRejectedValue(new Error("This repository is public."));
});
afterEach(() => vi.unstubAllEnvs());

describe("desktop content sync privacy", () => {
  const options = { repoRoot: "/private-content", emit: vi.fn() };
  it.each([
    ["commit all", () => commitAndPushDirty(options)],
    ["commit content", () => commitAndPushPaths({ ...options, paths: ["notes"], commitMessage: "chore: save notes" })],
    ["push existing commits", () => pushUnpushedCommits(options)],
    ["update and push", () => updateAndSync({ ...options, push: true })],
  ])("stops %s before Git mutations when origin is no longer private", async (_label, run) => {
    await expect(run()).rejects.toThrow("public");
    expect(mocks.assertPrivate).toHaveBeenCalledWith("/private-content");
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it("does not impose private-content restrictions on an unrelated code repo", async () => {
    mocks.git.mockReturnValue({ status: 0, stdout: "feature-branch", stderr: "" });
    await commitAndPushDirty({ repoRoot: "/another-project", emit: vi.fn() });
    expect(mocks.assertPrivate).not.toHaveBeenCalled();
  });
});
