/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GithubRepoCard, LocalRepoCard } from "@/app/repos/cards";
import type { GithubRepoInfo, RepoInfo } from "@/app/repos/types";

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/components/shell/ConfirmDialog", () => ({
  usePrompt: () => vi.fn(),
}));

vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({
  RepoGitWorkspace: () => <div data-testid="git-workspace">git</div>,
}));

vi.mock("@/components/repos/RepoOpenPrLink", () => ({
  RepoOpenPrLink: () => null,
}));

vi.mock("@/components/ui/HoverTip", () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

const repo: RepoInfo = {
  name: "example-service",
  path: "/tmp/example-service",
  branch: "main",
  dirtyCount: 0,
  remote: "origin",
  hasUpstart: true,
};

const githubRepo: GithubRepoInfo = {
  name: "example-service",
  fullName: "example-org/example-service",
  owner: "example-org",
  url: "https://github.com/example-org/example-service",
  description: "Frontend",
  isPrivate: true,
  defaultBranch: "master",
  localRepoName: null,
};

const localHandlers = {
  onLearn: vi.fn(),
  onDxAudit: vi.fn(),
  onUpstart: vi.fn(),
  onTerminal: vi.fn(),
  onRevealFolder: vi.fn(),
  onGitKraken: vi.fn(),
  onCursor: vi.fn(),
  onClaudeDesktop: vi.fn(),
  onRemove: vi.fn(),
  onRefreshLocal: vi.fn(),
  onToggleOwned: vi.fn(),
};

describe("LocalRepoCard context menu", () => {
  it("binds contextmenu on the card root, not only the kebab", () => {
    const { container } = render(
      <LocalRepoCard
        repo={repo}
        githubUrl={null}
        isDesktop
        opening={null}
        removing={null}
        ownershipFullName={null}
        owned={false}
        ownershipBusy={null}
        {...localHandlers}
      />,
    );

    const card = container.querySelector(".card");
    expect(card).toBeTruthy();
    expect(card?.className).toContain("group");
    expect(screen.getByRole("button", { name: "Actions for example-service" })).toBeTruthy();
    expect(card?.contains(screen.getByRole("button", { name: "Actions for example-service" }))).toBe(true);

    fireEvent.contextMenu(screen.getByTestId("git-workspace"), { clientX: 20, clientY: 40 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.getAttribute("aria-label")).toBe("example-service actions");
  });
});

describe("GithubRepoCard context menu", () => {
  it("binds contextmenu on the card root, including the title link", () => {
    const { container } = render(
      <GithubRepoCard
        repo={githubRepo}
        isDesktop
        opening={null}
        cloning={null}
        onCursor={vi.fn()}
        onClone={vi.fn()}
        owned={false}
        ownershipBusy={null}
        onToggleOwned={vi.fn()}
      />,
    );

    const card = container.querySelector(".card");
    expect(card).toBeTruthy();
    expect(card?.className).toContain("group");

    fireEvent.contextMenu(screen.getByText("example-org/example-service"), { clientX: 16, clientY: 32 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.getAttribute("aria-label")).toBe("example-org/example-service actions");
  });
});
