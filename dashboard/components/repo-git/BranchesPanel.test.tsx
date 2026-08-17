/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchesPayload } from "./shared";

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => false),
}));

vi.mock("@/components/shell/ConfirmDialog", () => ({
  useConfirm: () => confirmMock,
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
