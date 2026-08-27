/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchesPayload } from "./shared";

const { confirmMock, decisionMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => false),
  decisionMock: vi.fn(async () => null as string | null),
}));

vi.mock("@/components/shell/ConfirmDialog", () => ({
  useConfirm: () => confirmMock,
  useDecision: () => decisionMock,
  usePrompt: () => vi.fn(async () => null),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("./RemotesSection", () => ({
  RemotesSection: () => null,
}));

vi.mock("./RangeCompareModal", () => ({
  RangeCompareModal: () => null,
}));

import { BranchesPanel } from "./BranchesPanel";

const payload: BranchesPayload = {
  branches: [
    { name: "main", current: true, upstream: "origin/main", shortHash: "abc1234" },
    { name: "feature/x", current: false, upstream: "origin/feature/x", shortHash: "def5678" },
  ],
  remoteBranches: [],
  currentBranch: "main",
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  stashCount: 0,
  hasChanges: false,
  unpushedCommits: [],
  mainBranch: "origin/main",
  aheadMain: 0,
  behindMain: 2,
  remoteWebUrl: "https://github.com/org/repo",
  remotes: [{ name: "origin", fetchUrl: "git@github.com:org/repo.git", pushUrl: "git@github.com:org/repo.git" }],
};

function jsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response);
}

const posts: Record<string, unknown>[] = [];

beforeEach(() => {
  posts.length = 0;
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(false);
  decisionMock.mockReset();
  decisionMock.mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
        return jsonResponse({});
      }
      const url = String(input);
      if (url.includes("/git/remotes")) return jsonResponse({ remotes: [] });
      return jsonResponse(payload);
    }),
  );
});

async function renderPanel() {
  render(
    <BranchesPanel
      repoName="devhub"
      onMutate={vi.fn()}
      onConflict={vi.fn(async () => undefined)}
      onHookFailure={vi.fn()}
      pushing={false}
      onPush={vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(screen.getByText("feature/x")).toBeTruthy();
  });
}

async function openMenu(branch: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${branch}` }), {
    clientX: 24,
    clientY: 48,
  });
  await waitFor(() => {
    expect(screen.getAllByRole("menuitem", { hidden: true }).length).toBeGreaterThan(0);
  });
}

function menuItem(name: RegExp) {
  return screen.getByRole("menuitem", { name, hidden: true });
}

describe("BranchesPanel danger actions", () => {
  it("confirms delete from the kebab before POSTing", async () => {
    await renderPanel();

    await openMenu("feature/x");
    fireEvent.click(menuItem(/git branch -d/));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Delete branch feature/x?",
          variant: "danger",
        }),
      );
    });
    expect(posts).toEqual([]);
  });

  it("confirms force-push, hard reset, and force-delete, and only POSTs after OK", async () => {
    await renderPanel();

    await openMenu("main");
    fireEvent.click(menuItem(/Force-push with lease/));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Force-push rewritten history?",
          variant: "danger",
        }),
      );
    });
    expect(posts).toEqual([]);

    confirmMock.mockResolvedValueOnce(true);
    await openMenu("feature/x");
    fireEvent.click(menuItem(/Reset main to here|Hard reset/));
    await waitFor(() => {
      expect(posts).toEqual([expect.objectContaining({ action: "reset-to-branch", mode: "hard" })]);
    });
  });

  it("confirms sync-with-main before rewriting and pushing", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Sync 2/ }));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sync with origin/main?",
        }),
      );
    });
    expect(posts).toEqual([]);
  });
});

describe("BranchesPanel refresh", () => {
  it("re-fetches branches when the Refresh button is clicked", async () => {
    await renderPanel();
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/repos/devhub/branches");
  });

  it("polls quietly every 15s", async () => {
    vi.useFakeTimers();
    try {
      render(
        <BranchesPanel
          repoName="devhub"
          onMutate={vi.fn()}
          onConflict={vi.fn(async () => undefined)}
          onHookFailure={vi.fn()}
          pushing={false}
          onPush={vi.fn()}
        />,
      );
      const fetchMock = vi.mocked(fetch);
      await vi.advanceTimersByTimeAsync(0);
      const before = fetchMock.mock.calls.length;
      expect(before).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(fetchMock.mock.calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BranchesPanel checkout", () => {
  it("switches only on double-click", async () => {
    await renderPanel();
    const branch = screen.getByTitle("Double-click to check out feature/x");

    fireEvent.click(branch);
    expect(posts).toEqual([]);

    fireEvent.dblClick(branch);
    await waitFor(() => {
      expect(posts).toEqual([expect.objectContaining({ action: "checkout", branch: "feature/x" })]);
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("offers stash or merge only after Git says local work conflicts", async () => {
    await renderPanel();
    decisionMock.mockResolvedValueOnce("stash");
    let checkoutPosts = 0;
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method !== "POST") return jsonResponse(payload);
      posts.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
      checkoutPosts += 1;
      if (checkoutPosts === 1) {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({
            code: "checkout_would_conflict",
            branch: "feature/x",
            error: "would be overwritten",
            canMerge: true,
          }),
        } as Response;
      }
      return jsonResponse({});
    });

    fireEvent.dblClick(screen.getByTitle("Double-click to check out feature/x"));

    await waitFor(() => expect(decisionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(posts).toEqual([
        { action: "checkout", branch: "feature/x" },
        { action: "checkout", branch: "feature/x", strategy: "stash" },
      ]);
    });
  });
});
