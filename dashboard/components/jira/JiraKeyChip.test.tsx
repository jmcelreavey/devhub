/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JiraParentChip } from "./JiraKeyChip";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  openInBrowser: vi.fn(),
}));
vi.mock("@/lib/desktop/bridge", () => ({ openInBrowser: mocks.openInBrowser }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));

const parent = { key: "TEST-1", summary: "Subscription reliability" };
const parentButton = () => screen.getByRole("button", { name: "Copy parent ticket key TEST-1" });

beforeEach(() => {
  mocks.copy.mockResolvedValue(undefined);
  mocks.openInBrowser.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("copies the parent key and names its summary on hover", async () => {
  render(<JiraParentChip parent={parent} />);
  expect(parentButton().title).toBe("Copy TEST-1 · parent: Subscription reliability");

  fireEvent.click(parentButton());
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith("TEST-1"));
});

it("stays plain while open and is struck through and dimmed once the task is done", () => {
  const { rerender } = render(<JiraParentChip parent={parent} />);
  expect(parentButton().style.textDecoration).toBe("none");
  expect(parentButton().style.opacity).toBe("1");

  rerender(<JiraParentChip parent={parent} done />);
  expect(parentButton().style.textDecoration).toBe("line-through");
  expect(parentButton().style.opacity).toBe("0.5");
});

it("takes its colours from the quiet class rather than the accent chip styles", () => {
  render(<JiraParentChip parent={parent} />);
  expect(parentButton().classList.contains("jira-key-chip--quiet")).toBe(true);
  expect(parentButton().style.background).toBe("");
});

// window.open is a silent no-op in the desktop webview, so "Open in Jira" on a
// parent chip used to do nothing there. It must go through the shell opener.
it("opens the parent on its real Jira domain through the desktop opener", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<JiraParentChip parent={{ ...parent, url: "https://acme.atlassian.net/browse/TEST-1" }} />);

  fireEvent.contextMenu(parentButton(), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole("menuitem", { name: /Open in Jira/, hidden: true }));

  expect(mocks.openInBrowser).toHaveBeenCalledWith("https://acme.atlassian.net/browse/TEST-1");
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

it("uses the configured browse URL when the parent ref carries no url", () => {
  vi.stubEnv("JIRA_DOMAIN", "acme.atlassian.net");
  render(<JiraParentChip parent={parent} />);

  fireEvent.contextMenu(parentButton(), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole("menuitem", { name: /Open in Jira/, hidden: true }));

  expect(mocks.openInBrowser).toHaveBeenCalledWith("https://acme.atlassian.net/browse/TEST-1");
});

it("uses the redirect when no Jira domain is configured", () => {
  vi.stubEnv("JIRA_DOMAIN", "");
  vi.stubEnv("NEXT_PUBLIC_JIRA_DOMAIN", "");
  render(<JiraParentChip parent={parent} />);

  fireEvent.contextMenu(parentButton(), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole("menuitem", { name: /Open in Jira/, hidden: true }));

  expect(mocks.openInBrowser).toHaveBeenCalledWith("/api/jira/ticket/TEST-1/redirect");
});
