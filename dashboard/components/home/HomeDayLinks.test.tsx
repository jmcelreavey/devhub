/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeContext, HomeDayLinks } from "./HomeDayLinks";
import type { GithubPrsApiPayload } from "@/lib/github/prs";

const state = vi.hoisted(() => ({ live: vi.fn(), retry: vi.fn(), openInBrowser: vi.fn(), payloads: {} as Record<string, { data?: unknown; error?: Error }> }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: state.live }));
vi.mock("@/components/jira/JiraStatusPill", () => ({ JiraStatusPill: ({ ticketKey, status, profile }: { ticketKey: string; status: string; profile?: string }) => <button data-profile={profile} aria-label={`Move ${ticketKey}`}>{status}</button> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/hooks/use-tag-menu", () => ({ useTagMenuGroup: () => ({ group: null, modal: null }), withTagsGroup: (groups: unknown) => groups }));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => false }));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: ({ open, jiraKey }: { open: boolean; jiraKey: string }) => open ? <div role="dialog" aria-label={`Move ${jiraKey} status`} /> : null }));
vi.mock("@/lib/desktop/bridge", () => ({ openInBrowser: state.openInBrowser }));
import { NOTES_OPEN_PATH_EVENT } from "@/lib/notes/open-in-panel";
vi.mock("@/components/prs/WorktreeCleanupPanel", () => ({ WORKTREE_CLEANUP_KEY: "/api/repos/worktree-cleanup", WORKTREE_CLEANUP_OPTS: { refreshInterval: 0 } }));

const pr = (n: number) => ({ repo: "acme/app", number: n, title: `PR ${n}`, url: `https://github.com/acme/app/pull/${n}` });
const prs: GithubPrsApiPayload = { configured: true, authored: Array.from({ length: 7 }, (_, n) => pr(n)), reviews: [], recentlyReviewed: [] };
const ticket = (n: number) => ({ key: `APP-${n}`, summary: `Ticket ${n}`, url: `https://jira.example/browse/APP-${n}`, status: "In Progress" });
const now = Date.parse("2026-10-18T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  state.payloads = {
    "/api/jira/tickets": { data: { configured: true, tickets: Array.from({ length: 6 }, (_, n) => ticket(n)) } },
    "/api/github/prs/owned": { data: { prs: Array.from({ length: 5 }, (_, n) => pr(n + 10)), failedRepos: [], limited: false } },
    "/api/calendar": { data: { events: [{ id: "meeting", title: "Planning", start: "2026-10-18T14:00:00Z", end: "2026-10-18T14:30:00Z" }] } },
    "/api/repos/worktree-cleanup": { data: { rows: [{ path: "/a" }, { path: "/b" }], failedRepos: [] } },
  };
  state.live.mockImplementation((key: string | null) => ({ ...(key ? state.payloads[new URL(key, "http://localhost").pathname] : {}), mutate: state.retry }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Home day coverage", () => {
  it("keeps peer reviews in Review with deduplication, preview expansion and shared actions", () => {
    render(<HomeDayLinks profile="work" unavailable={false} prs={{ ...prs, reviews: [pr(20), pr(20), pr(21), pr(22), pr(23)] }} githubUnavailable={false} />);
    const region = within(screen.getByRole("region", { name: "PRs" }));
    expect(region.queryByText("PR 20")).toBeNull();
    fireEvent.click(region.getByRole("button", { name: "Review" }));
    expect(region.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
    expect(region.getByLabelText("4 review requested PRs")).toHaveTextContent("4");
    expect(region.getAllByRole("listitem")).toHaveLength(3);
    expect(region.getByRole("link", { name: "View all review requested PRs" })).toHaveAttribute("href", "/prs?tab=reviews&profile=work");
    fireEvent.click(region.getByRole("button", { name: "Show 1 more" }));
    expect(region.getAllByRole("listitem")).toHaveLength(4);
    fireEvent.contextMenu(region.getByRole("link", { name: "PR 20 acme/app #20" }));
    const menu = menuNamed("acme/app#20 actions");
    expect(within(menu).getByText("Review with agent", { exact: false })).toBeInTheDocument();
    expect(within(menu).getByText("Skip until updated", { exact: false })).toBeInTheDocument();
  });

  it("keeps Review loading and outage states distinct from an empty inbox", () => {
    const view = render(<HomeDayLinks profile="work" unavailable={false} githubUnavailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("Loading PRs")).toBeInTheDocument();
    expect(screen.queryByText("No PR reviews requested")).toBeNull();
    view.rerender(<HomeDayLinks profile="work" unavailable={false} prs={{ ...prs, reviews: [pr(20)] }} githubUnavailable />);
    expect(screen.getByText("PR 20")).toBeInTheDocument();
    expect(screen.getByLabelText("PR total unavailable")).toBeInTheDocument();
    view.rerender(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
    expect(screen.getByText("No PR reviews requested")).toBeInTheDocument();
  });

  it("caps tickets and the selected PR category at three while showing the complete loaded totals", () => {
    render(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
    const tickets = within(screen.getByRole("region", { name: "Tickets" }));
    expect(tickets.getAllByRole("listitem")).toHaveLength(3);
    expect(tickets.getByLabelText("6 tickets")).toHaveTextContent("6");
    expect(tickets.getByRole("link", { name: "View all tickets" })).toHaveAttribute("href", "/work?tab=jira&profile=work");
    expect(tickets.getByRole("link", { name: "Ticket 0 APP-0" })).toHaveAttribute("href", "https://jira.example/browse/APP-0");
    expect(tickets.getByRole("button", { name: "Move APP-0" })).toHaveAttribute("data-profile", "work");
    const region = within(screen.getByRole("region", { name: "PRs" }));
    expect(region.getAllByRole("listitem")).toHaveLength(3);
    expect(region.getByLabelText("7 my PRs")).toHaveTextContent("7");
    expect(region.getByRole("link", { name: "View all my PRs" })).toHaveAttribute("href", "/prs?tab=authored&profile=work");
    fireEvent.click(region.getByRole("button", { name: "Owned" }));
    expect(region.getAllByRole("listitem")).toHaveLength(3);
    expect(region.getByLabelText("5 owned PRs")).toHaveTextContent("5");
    expect(region.getByRole("link", { name: "View all owned PRs" })).toHaveAttribute("href", "/prs?tab=owned&profile=work");
    expect(state.live).toHaveBeenCalledWith("/api/github/prs/owned?taskProfile=work", expect.objectContaining({ keepPreviousData: false }));
  });

  it("keeps calendar and worktree cleanup as one-click links without a delete action", () => {
    render(<HomeContext profile="work" now={now} unavailable={false} />);
    expect(screen.getByRole("link", { name: /Next meeting.*Planning/ })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: "Worktrees · 2 finished →" })).toHaveAttribute("href", "/prs?tab=cleanup&profile=work");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows skeletons while loading and no invented zero or empty state", () => {
    state.payloads = {};
    const view = render(<><HomeContext profile="work" now={now} unavailable={false} /><HomeDayLinks profile="work" unavailable={false} githubUnavailable={false} /></>);
    for (const label of ["Loading calendar", "Loading worktrees", "Loading tickets", "Loading PRs"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Tickets total unavailable")).toHaveTextContent("—");
    expect(screen.getByLabelText("PR total unavailable")).toHaveTextContent("—");
    expect(screen.queryByText(/No open/)).toBeNull();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });

  it("reports independent failures, retains last-known rows, and never labels them zero", () => {
    for (const source of Object.values(state.payloads)) source.error = new Error("Offline");
    render(<><HomeContext profile="work" now={now} unavailable={false} /><HomeDayLinks profile="work" unavailable={false} prs={{ ...prs, authored: [] }} githubUnavailable /></>);
    expect(screen.getByText("Calendar unavailable →")).toBeInTheDocument();
    expect(screen.getByText("Worktrees · count unavailable →")).toBeInTheDocument();
    expect(screen.getByText("Jira unavailable. Ticket totals are unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ticket 0 APP-0" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tickets total unavailable")).toHaveTextContent("—");
    expect(screen.getByLabelText("PR total unavailable")).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Owned" }));
    expect(screen.getByText("GitHub unavailable. Owned PR totals are unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/No open/)).toBeNull();
  });

  it("distinguishes clean emptiness, missing integration, partial results and an upstream cap", () => {
    state.payloads["/api/jira/tickets"] = { data: { configured: true, tickets: [] } };
    state.payloads["/api/github/prs/owned"] = { data: { prs: [], failedRepos: [] } };
    const view = render(<HomeDayLinks profile="work" unavailable={false} prs={{ ...prs, authored: [] }} githubUnavailable={false} />);
    expect(screen.getByText("No open tickets assigned to you")).toBeInTheDocument();
    expect(screen.getByText("No open PRs of yours")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Owned" }));
    expect(screen.getByText(/No open PRs in your/)).toBeInTheDocument();
    state.payloads["/api/jira/tickets"] = { data: { configured: false, tickets: [] } };
    state.payloads["/api/github/prs/owned"] = { data: { prs: [], failedRepos: ["acme/app"] } };
    view.rerender(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
    expect(screen.queryByText(/No open/)).toBeNull();
    state.payloads["/api/github/prs/owned"] = { data: { prs: [pr(1)], failedRepos: [], limited: true } };
    view.rerender(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
    expect(screen.getByLabelText("At least 1 owned PRs")).toHaveTextContent("1+");
  });

  it("changes every read identity with the profile and hides data when profile confirmation fails", () => {
    const view = render(<><HomeContext profile="work" now={now} unavailable={false} /><HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Owned" }));
    view.rerender(<><HomeContext profile="home" now={now} unavailable={false} /><HomeDayLinks profile="home" unavailable={false} prs={prs} githubUnavailable={false} /></>);
    for (const endpoint of Object.keys(state.payloads)) expect(state.live).toHaveBeenCalledWith(`${endpoint}?taskProfile=home`, expect.objectContaining({ keepPreviousData: false }));
    view.rerender(<><HomeContext now={now} unavailable /><HomeDayLinks unavailable githubUnavailable /></>);
    expect(screen.queryByRole("link", { name: "Ticket 0 APP-0" })).toBeNull();
    expect(screen.getByLabelText("Tickets total unavailable")).toHaveTextContent("—");
  });
});

it("expands tickets and PRs independently and resets expansion when changing PR category", () => {
  render(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
  const tickets = within(screen.getByRole("region", { name: "Tickets" }));
  const region = within(screen.getByRole("region", { name: "PRs" }));
  fireEvent.click(tickets.getByRole("button", { name: "Show 3 more" }));
  expect(tickets.getAllByRole("listitem")).toHaveLength(6);
  expect(region.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(region.getByRole("button", { name: "Show 4 more" }));
  expect(region.getAllByRole("listitem")).toHaveLength(7);
  fireEvent.click(region.getByRole("button", { name: "Owned" }));
  expect(region.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(tickets.getByRole("button", { name: "Show less" }));
  expect(tickets.getAllByRole("listitem")).toHaveLength(3);
});

const menuNamed = (name: string) => document.querySelector<HTMLElement>(`[role="menu"][aria-label="${name}"]`)!;
it("opens the shared PR and Jira menus on right-click and from the keyboard", () => {
  render(<HomeDayLinks profile="work" unavailable={false} prs={prs} githubUnavailable={false} />);
  const region = within(screen.getByRole("region", { name: "PRs" }));
  fireEvent.contextMenu(region.getByRole("link", { name: "PR 0 acme/app #0" }));
  const prMenu = menuNamed("acme/app#0 actions");
  for (const item of ["Open on GitHub", "Copy PR URL", "Open in Cursor", "Review with agent", "Open review note", "Skip until updated"]) expect(within(prMenu).getByText(item, { exact: false })).toBeInTheDocument();
  fireEvent.click(within(prMenu).getByText("Open on GitHub", { exact: false }));
  expect(state.openInBrowser).toHaveBeenCalledWith("https://github.com/acme/app/pull/0");

  fireEvent.click(region.getByRole("button", { name: "Owned" }));
  fireEvent.contextMenu(region.getByRole("link", { name: "PR 10 acme/app #10" }));
  const owned = menuNamed("acme/app#10 actions");
  expect(within(owned).getByText("Review with agent", { exact: false })).toBeInTheDocument();
  expect(within(owned).queryByText("Skip until updated", { exact: false })).toBeNull();

  const tickets = within(screen.getByRole("region", { name: "Tickets" }));
  fireEvent.keyDown(tickets.getByRole("link", { name: "Ticket 0 APP-0" }), { key: "F10", shiftKey: true });
  const ticketMenu = menuNamed("APP-0 actions");
  for (const item of ["Open in Jira", "Copy key", "Copy browse URL", "Update ticket state", "Add to board", "Write plan with Agent", "Implement with Agent"]) expect(within(ticketMenu).getByText(item, { exact: false })).toBeInTheDocument();
  fireEvent.click(within(ticketMenu).getByText("Update ticket state", { exact: false }));
  expect(screen.getByRole("dialog", { name: "Move APP-0 status" })).toBeInTheDocument();
  expect(tickets.getByRole("button", { name: "Actions for APP-1" })).toHaveAttribute("aria-haspopup", "menu");
});

describe("Home Review tab PR click", () => {
  it("opens the review note in the Notes side panel and keeps GitHub as a secondary link", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Saved review"));
    const onOpen = vi.fn();
    window.addEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
    render(<HomeDayLinks profile="work" unavailable={false} prs={{ ...prs, reviews: [pr(20)] }} githubUnavailable={false} />);
    const region = within(screen.getByRole("region", { name: "PRs" }));
    fireEvent.click(region.getByRole("button", { name: "Review" }));
    const title = region.getByRole("link", { name: "PR 20 acme/app #20" });
    expect(title.getAttribute("href")).toMatch(/^\/notes\//);
    expect(title).not.toHaveAttribute("target");
    expect(region.getByRole("link", { name: "Open acme/app#20 on GitHub" })).toHaveAttribute("href", "https://github.com/acme/app/pull/20");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(title, click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(String), { cache: "no-store" });
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    fireEvent(title, modified);
    expect(modified.defaultPrevented).toBe(false);
    window.removeEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
  });
});
