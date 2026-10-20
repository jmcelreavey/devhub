/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerPrDetailPanel } from "./PeerPrDetailPanel";
import type { GithubPrRow } from "@/lib/github/prs";

const state = vi.hoisted(() => ({ active: "work", authored: [] as GithubPrRow[], close: vi.fn(), refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (key: string | null) => ({ data: key === "/api/tasks/profiles" ? { active: state.active } : key ? { configured: true, authored: state.authored, reviews: [{ repo: "acme/app", number: 42, title: "Peer change", url: "https://github.com/acme/app/pull/42", checks: "passing" }] } : undefined, mutate: state.refresh }) }));

beforeEach(() => { state.active = "work"; state.authored = []; vi.clearAllMocks(); vi.stubGlobal("fetch", state.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PR-identity shared detail", () => {
  it("shows an actionable own PR as yours rather than a requested peer review", () => {
    state.authored = [{ repo: "acme/app", number: 42, title: "My failing check", url: "https://github.com/acme/app/pull/42", checks: "failing" }];
    render(<PeerPrDetailPanel identity="acme/app#42" requestedProfile="work" onClose={state.close} />);
    expect(screen.getByRole("dialog", { name: "PR: My failing check" })).toBeInTheDocument();
    expect(screen.getByText("Your PR · checks failing")).toBeInTheDocument();
    expect(screen.queryByText(/Review requested/)).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("shows a PR, never a made-up task, and keeps GitHub review deliberate", () => {
    render(<PeerPrDetailPanel identity="acme/app#42" requestedProfile="work" onClose={state.close} />);
    expect(screen.getByRole("dialog", { name: "PR: Peer change" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute("href", "https://github.com/acme/app/pull/42");
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("doesn't open a matching PR from a different profile after a switch or on a stale deep link", () => {
    const view = render(<PeerPrDetailPanel identity="acme/app#42" requestedProfile="work" onClose={state.close} />);
    state.active = "home";
    view.rerender(<PeerPrDetailPanel identity="acme/app#42" requestedProfile="work" onClose={state.close} />);
    expect(screen.getByRole("alert")).toHaveTextContent("opened in work, but the active profile is now home");
    expect(screen.queryByRole("link", { name: "Open PR" })).toBeNull();
    view.unmount();
    render(<PeerPrDetailPanel identity="acme/app#42" requestedProfile="work" onClose={state.close} />);
    expect(screen.getByRole("alert")).toHaveTextContent("opened in work");
  });
});
