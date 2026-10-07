/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RepoGitPage } from "./client";

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  mutate: vi.fn(),
  mutateKey: vi.fn(),
  useLive: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ cache: new Map(), mutate: mocks.mutateKey }) }));
vi.mock("@/lib/hooks/use-session-history", () => ({ useRouteHistoryLabel: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.useLive }));
vi.mock("@/components", () => ({
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
  FetchError: ({ message }: { message: string }) => <p role="alert">{message}</p>,
  SkeletonRows: () => <p>Loading</p>,
}));
vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({
  RepoGitWorkspace: (props: {
    initialTab?: string;
    focusPath?: string | null;
    onFocusPathConsumed: () => void;
    onMutate: () => void;
  }) => (
    <section aria-label="Git">
      <output data-testid="pane">{props.initialTab}</output>
      <output data-testid="focus">{props.focusPath}</output>
      <button onClick={props.onFocusPathConsumed}>File selected</button>
      <button onClick={props.onMutate}>Mutation completed</button>
    </section>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = new URLSearchParams();
  mocks.useLive.mockReturnValue({
    data: { repo: { name: "demo", path: "/tmp/demo", dirtyCount: 2, unpushedCount: 1 } },
    mutate: mocks.mutate,
  });
});
afterEach(cleanup);

describe("Git route navigation", () => {
  it("consumes a file deep link so refreshes cannot reset the user's selection", () => {
    mocks.search = new URLSearchParams({ path: "src/first.ts" });
    const { rerender } = render(<RepoGitPage name="demo" />);
    expect(screen.getByTestId("pane").textContent).toBe("changes");
    expect(screen.getByTestId("focus").textContent).toBe("src/first.ts");
    fireEvent.click(screen.getByText("File selected"));
    rerender(<RepoGitPage name="demo" />);
    expect(screen.getByTestId("focus").textContent).toBe("");
    mocks.search = new URLSearchParams({ path: "src/second.ts" });
    rerender(<RepoGitPage name="demo" />);
    expect(screen.getByTestId("focus").textContent).toBe("src/second.ts");
  });

  it("opens History for an unpushed link even without a tab parameter", () => {
    mocks.search = new URLSearchParams({ unpushed: "1" });
    render(<RepoGitPage name="demo" />);
    expect(screen.getByTestId("pane").textContent).toBe("history");
  });

  it("refreshes repo cards and the content-sync indicator after Git changes", () => {
    render(<RepoGitPage name="demo" />);
    fireEvent.click(screen.getByText("Mutation completed"));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutateKey).toHaveBeenCalledWith("/api/repos");
    expect(mocks.mutateKey).toHaveBeenCalledWith("/api/status/git");
  });

  it("reports a refresh error even when cached repo data exists", () => {
    mocks.useLive.mockReturnValue({
      data: { repo: { name: "demo", path: "/tmp/demo", dirtyCount: 2 } },
      error: new Error("Repository unavailable"),
      mutate: mocks.mutate,
    });
    render(<RepoGitPage name="demo" />);
    expect(screen.getByRole("alert").textContent).toBe("Repository unavailable");
    expect(screen.getByRole("region", { name: "Git" })).toBeTruthy();
  });
});
