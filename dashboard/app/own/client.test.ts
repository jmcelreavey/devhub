/** @vitest-environment jsdom */
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedOwnedRepo } from "@/lib/ownership/types";
import { OwnRepoCard } from "./client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/components/shell/ConfirmDialog", () => ({
  useConfirm: () => vi.fn(),
  usePrompt: () => vi.fn(),
}));

vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({
  RepoGitWorkspace: () => createElement("div", { "data-testid": "git-workspace" }),
}));

const repo: ResolvedOwnedRepo = {
  name: "example-service",
  fullName: "example-org/example-service",
  owner: "example-org",
  addedAt: "2026-01-01",
  lastVisited: null,
  lastSeenSha: null,
  domains: null,
  teams: null,
  localRepoName: "example-service",
  localPath: "/tmp/example-service",
  url: "https://github.com/example-org/example-service",
  defaultBranch: "master",
};

describe("OwnRepoCard context menu", () => {
  it("binds the whole card and ships Cursor, GitHub, and stop owning", () => {
    const { container } = render(
      createElement(OwnRepoCard, {
        repo,
        summary: undefined,
        local: {
          name: "example-service",
          path: "/tmp/example-service",
          branch: "master",
          dirtyCount: 0,
          remote: "origin",
          hasUpstart: true,
        },
        revealLabel: "Reveal in Finder",
        busy: false,
        onRemove: vi.fn(),
        onLocalMutate: vi.fn(),
      }),
    );

    const card = container.querySelector(".card");
    expect(card).toBeTruthy();
    expect(card?.className).toContain("group");
    expect(screen.getByRole("button", { name: "Actions for example-org/example-service" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByText("example-org/example-service"), { clientX: 16, clientY: 32 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.getAttribute("aria-label")).toBe("example-org/example-service actions");
    expect(menu?.textContent).toContain("Open in Cursor");
    expect(menu?.textContent).toContain("Open on GitHub");
    expect(menu?.textContent).toContain("Stop owning");
  });

  it("surfaces review-requested and last-look facts on the card", () => {
    render(
      createElement(OwnRepoCard, {
        repo: { ...repo, lastVisited: "2026-08-12T12:00:00.000Z" },
        summary: {
          repo: { ...repo, lastVisited: "2026-08-12T12:00:00.000Z" },
          obligations: {
            defaultBranchCi: "passing",
            staleBranches: [],
            botPrs: 0,
            unassignedIssues: 0,
            partial: false,
          },
          openPrs: 3,
          reviewRequested: 1,
          unattended: 0,
          attention: { score: 4, reasons: ["1 review requested of you"] },
          error: null,
        },
        local: {
          name: "example-service",
          path: "/tmp/example-service",
          branch: "master",
          dirtyCount: 0,
          remote: "origin",
          hasUpstart: true,
        },
        revealLabel: "Reveal in Finder",
        busy: false,
        onRemove: vi.fn(),
        onLocalMutate: vi.fn(),
      }),
    );

    expect(screen.getByText(/3 open PRs/)).toBeTruthy();
    expect(screen.getByText(/1 waiting on you/)).toBeTruthy();
    expect(screen.getByText(/Needs attention: 1 review requested of you/)).toBeTruthy();
  });
});
