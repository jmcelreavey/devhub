/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReposActions } from "./useReposActions";
import type { RepoInfo } from "./types";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  decide: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  terminal: vi.fn(),
  command: vi.fn(() => "upstart command"),
  agent: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/components/shell/ConfirmDialog", () => ({
  usePrompt: () => mocks.prompt,
  useDecision: () => mocks.decide,
  useConfirm: () => mocks.confirm,
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: mocks.error, success: vi.fn() }) }));
vi.mock("@/lib/agent-job", () => ({ launchAgentJob: mocks.agent }));
vi.mock("@/lib/terminal-launch", () => ({
  openTerminal: mocks.terminal,
  repoUpstartCommand: mocks.command,
  agentRepoDxAuditPrompt: vi.fn(),
  UPSTART_WORKTREE_INSTRUCTIONS: "Keep the selected workspace.",
}));

const repo: RepoInfo = {
  name: "demo",
  path: "/repos/demo",
  branch: "main",
  dirtyCount: 0,
  remote: null,
  hasUpstart: true,
  upstartPath: "/devhub/upstarts/demo/upstart.sh",
};
const main = { path: repo.path, branch: "main", prunable: false };
const feature = { path: "/repos/demo feature", branch: "feature/ui", prunable: false };
function setup() {
  return renderHook(() => useReposActions({
    mutateLocal: vi.fn().mockResolvedValue(undefined),
    mutateGithub: vi.fn().mockResolvedValue(undefined),
  }));
}
function respond(worktrees: unknown[], ok = true) {
  mocks.fetch.mockResolvedValue({ ok, json: async () => ({ worktrees }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.decide.mockResolvedValue(feature.path);
  mocks.prompt.mockResolvedValue("");
  mocks.agent.mockResolvedValue(undefined);
  respond([main]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Upstart workspace selection", () => {
  it("starts a task's associated checkout directly", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ worktrees: [main, feature], preferredPath: feature.path }) });
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo, false, undefined, "task-1"));
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalledWith(repo.upstartPath, feature.path);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/repos/demo/worktrees?taskId=task-1", expect.anything());
  });
  it("refuses to substitute another branch for a missing task checkout", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ worktrees: [main], preferredPath: feature.path }) });
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo, false, undefined, "task-1"));
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("no longer available"));
  });

  it("runs a single available workspace directly with the canonical script", async () => {
    respond([main, { ...feature, prunable: true }]);
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalledWith(repo.upstartPath, repo.path);
    expect(mocks.terminal).toHaveBeenCalledWith(expect.objectContaining({ cwd: repo.path, repoName: repo.name }));
    expect(result.current.upstarting).toBeNull();
  });

  it("shows branch and full folder, marks current checkout, and launches the chosen worktree", async () => {
    respond([main, feature]);
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({
      options: [
        { value: main.path, label: "main", description: "main · Current checkout", hint: `main\n${main.path}` },
        { value: feature.path, label: "feature ui", description: "feature/ui", hint: `feature/ui\n${feature.path}` },
      ],
    }));
    expect(mocks.command).toHaveBeenCalledWith(repo.upstartPath, feature.path);
    expect(mocks.terminal).toHaveBeenCalledWith(expect.objectContaining({ cwd: feature.path, repoName: repo.name }));
    expect(mocks.fetch).toHaveBeenCalledWith("/api/repos/demo/worktrees", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("orders the current checkout first, then named branches, then detached folders", async () => {
    const alpha = { path: "/repos/alpha", branch: "alpha", prunable: false };
    const detachedA = { path: "/tmp/a", branch: null, prunable: false };
    const detachedZ = { path: "/tmp/z", branch: null, prunable: false };
    respond([detachedZ, feature, detachedA, main, alpha]);
    mocks.decide.mockResolvedValue(null);
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.decide.mock.calls[0][0].options.map((option: { value: string }) => option.value))
      .toEqual([main.path, alpha.path, feature.path, detachedA.path, detachedZ.path]);
    expect(mocks.terminal).not.toHaveBeenCalled();
  });

  it.each(["chooser", "context"])("cancelling the %s starts nothing", async (step) => {
    respond(step === "chooser" ? [main, feature] : [main]);
    if (step === "chooser") mocks.decide.mockResolvedValue(null);
    else mocks.prompt.mockResolvedValue(null);
    const { result } = setup();
    await act(async () => result.current.openUpstart({ ...repo, hasUpstart: false }));
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.agent).not.toHaveBeenCalled();
    expect(result.current.upstarting).toBeNull();
  });

  it.each([
    { hasUpstart: false, debug: false, context: undefined, mode: "oneshot" },
    { hasUpstart: true, debug: true, context: undefined, mode: "interactive" },
    { hasUpstart: true, debug: false, context: "Use port 4000", mode: "oneshot" },
  ])("generates, debugs, or updates in the selected workspace: %j", async ({ hasUpstart, debug, context, mode }) => {
    respond([main, feature]);
    const { result } = setup();
    await act(async () => result.current.openUpstart({ ...repo, hasUpstart }, debug, context));
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({
      cwd: feature.path, repoName: repo.name, mode,
      promptText: expect.stringContaining(repo.upstartPath!),
    }));
    expect(mocks.terminal).not.toHaveBeenCalled();
  });

  it.each(["http", "invalid", "empty"])("refuses to guess a folder after a %s response", async (failure) => {
    if (failure === "http") respond([main], false);
    if (failure === "invalid") respond([{ path: 12 }]);
    if (failure === "empty") respond([{ ...main, prunable: true }]);
    const { result } = setup();
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.agent).not.toHaveBeenCalled();
    expect(result.current.upstarting).toBeNull();
  });

  it("ignores repeat clicks while choosing and fetches afresh on the next launch", async () => {
    respond([main, feature]);
    let choose: (path: string | null) => void = () => {};
    mocks.decide.mockImplementationOnce(() => new Promise<string | null>((resolve) => { choose = resolve; }));
    const { result } = setup();
    let first!: Promise<void>;
    await act(async () => { first = result.current.openUpstart(repo); });
    expect(result.current.upstarting).toBe(repo.name);
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { choose(null); await first; });
    await act(async () => result.current.openUpstart(repo));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.terminal).toHaveBeenCalledOnce();
  });

  it("keeps the launch guarded until the agent handoff finishes", async () => {
    let finish: () => void = () => {};
    mocks.agent.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = setup();
    let launch!: Promise<void>;
    await act(async () => { launch = result.current.openUpstart(repo, true); });
    expect(result.current.upstarting).toBe(repo.name);
    await act(async () => result.current.openUpstart(repo, true));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.agent).toHaveBeenCalledOnce();
    await act(async () => { finish(); await launch; });
    expect(result.current.upstarting).toBeNull();
  });

  it("aborts a stalled lookup after ten seconds without launching", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const { result } = setup();
    let run!: Promise<void>;
    act(() => { run = result.current.openUpstart(repo); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); await run; });
    expect(mocks.error).toHaveBeenCalledWith("Loading workspaces timed out. Try Upstart again.");
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(result.current.upstarting).toBeNull();
  });
});
