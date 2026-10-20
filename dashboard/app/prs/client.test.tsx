/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubPrRow, GithubPrsApiPayload } from "@/lib/github/prs";
import PrsPage from "./client";

const state = vi.hoisted(() => ({
  query: "", data: undefined as GithubPrsApiPayload | undefined,
  repos: ["acme/app"] as string[] | undefined, ownedError: undefined as Error | undefined,
  replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (key: string) => ({
  data: key === "/api/github/prs" ? state.data : key === "/api/own" ? state.repos ? { repos: state.repos.map((fullName) => ({ fullName })) } : undefined : key === "/api/tasks/profiles" ? { active: "work" } : key === "/api/github/prs/skip" ? { skipped: [] } : { rows: [] },
  error: key === "/api/own" ? state.ownedError : undefined, mutate: state.refresh, isLoading: false, isValidating: false,
}) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/hooks/use-sidebar-counts", () => ({ useMarkPrsSeen: vi.fn() }));
vi.mock("@/lib/hooks/use-github-pr-search", () => ({ useGithubPrSearch: () => ({ results: [], loading: false }) }));
vi.mock("@/components/today/TodayBootScreen", () => ({ BootScreen: () => null, useBootGate: () => ({}) }));
vi.mock("@/components/PrRow", () => ({ PrRow: ({ row }: { row: GithubPrRow }) => <article>{row.title}</article> }));
vi.mock("@/components/github/PrStatusMenu", () => ({ usePrStatusMenu: () => ({ bind: {}, menuNode: null }) }));
vi.mock("./AutoReviewBar", () => ({ AutoReviewBar: () => <div>Auto review settings</div> }));
vi.mock("@/components/prs/OwnedPrsPanel", () => ({ OwnedPrsPanel: () => <div>Owned inventory</div> }));
vi.mock("@/components/prs/WorktreeCleanupPanel", () => ({ WorktreeCleanupPanel: () => <div>Worktree cleanup</div>, WORKTREE_CLEANUP_KEY: "/api/repos/worktree-cleanup", WORKTREE_CLEANUP_OPTS: {} }));
vi.mock("@/components", () => ({
  FetchError: ({ message }: { message: string }) => <p role="alert">{message}</p>,
  EmptyState: ({ title }: { title: ReactNode }) => <p>{title}</p>,
  InlineSearch: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />,
  SkeletonRows: () => <div role="status">Loading PRs</div>,
}));

const pr = (number: number, title: string, patch: Partial<GithubPrRow> = {}): GithubPrRow => ({ repo: "acme/app", number, title, url: `https://github.com/acme/app/pull/${number}`, checks: "passing", ...patch });
beforeEach(() => {
  vi.clearAllMocks();
  state.query = ""; state.repos = ["acme/app"]; state.ownedError = undefined;
  state.data = { configured: true, authored: [pr(1, "Mine failing", { repo: "other/mine", checks: "failing" }), pr(2, "Mine waiting"), pr(3, "Mine ready", { approved: true })], reviews: [pr(4, "Owned review"), pr(5, "Team review", { repo: "team/other" })], recentlyReviewed: [] };
});
afterEach(cleanup);

describe("calm PR default", () => {
  it("defaults to Mine + Owned needing action, with the shared actionable header total", () => {
    render(<PrsPage />);
    expect(screen.getByRole("button", { name: "Mine + Owned" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article").map((row) => row.textContent)).toEqual(["Mine failing", "Mine ready", "Owned review"]);
    expect(screen.getByLabelText("3 pull requests need you")).toHaveTextContent("3");
    expect(screen.queryByText("Mine waiting")).toBeNull();
    expect(screen.queryByText("Team review")).toBeNull();
    expect(screen.getByRole("button", { name: "Review requested" })).toBeInTheDocument();
  });

  it("keeps the all-requested review tab reachable without an inventory header count", () => {
    state.query = "tab=reviews";
    render(<PrsPage />);
    expect(screen.getAllByRole("article").map((row) => row.textContent)).toEqual(["Owned review", "Team review"]);
    expect(screen.getByLabelText("3 pull requests need you")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Review requested" })).toHaveAttribute("aria-pressed", "true");
  });

  it("retains authored, owned and worktree bookmarks", () => {
    state.query = "tab=authored";
    const page = render(<PrsPage />);
    expect(screen.getByText("Mine waiting")).toBeInTheDocument();
    state.query = "tab=owned"; page.rerender(<PrsPage />);
    expect(screen.getByText("Owned inventory")).toBeInTheDocument();
    state.query = "tab=cleanup"; page.rerender(<PrsPage />);
    expect(screen.getByText("Worktree cleanup")).toBeInTheDocument();
  });

  it("preserves other query parameters when changing tabs", () => {
    state.query = "q=login&repo=app";
    render(<PrsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review requested" }));
    expect(state.replace).toHaveBeenCalledWith("/prs?q=login&repo=app&tab=reviews", { scroll: false });
  });

  it("hides a zero header badge without turning unrelated team requests into work", () => {
    state.data = { ...state.data!, authored: [], reviews: [pr(5, "Team review", { repo: "team/other" })] };
    render(<PrsPage />);
    expect(screen.queryByLabelText(/pull requests need you/)).toBeNull();
    expect(screen.getByText("Nothing needs you in Mine or Owned.")).toBeInTheDocument();
  });

  it("does not present unknown ownership as an empty queue", () => {
    state.repos = undefined;
    const page = render(<PrsPage />);
    expect(screen.queryByLabelText(/pull requests need you/)).toBeNull();
    expect(screen.getByText("Loading PRs")).toHaveAttribute("role", "status");
    state.ownedError = new Error("Offline"); page.rerender(<PrsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Review totals are unavailable");
    expect(screen.queryByText("Nothing needs you in Mine or Owned.")).toBeNull();
  });
});
