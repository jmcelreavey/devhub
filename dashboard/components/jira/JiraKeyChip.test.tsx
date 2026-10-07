/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JiraParentChip } from "./JiraKeyChip";

const mocks = vi.hoisted(() => ({ copy: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));

const parent = { key: "TEST-1", summary: "Subscription reliability" };
const parentButton = () => screen.getByRole("button", { name: "Copy parent ticket key TEST-1" });

beforeEach(() => mocks.copy.mockResolvedValue(undefined));
afterEach(() => {
  cleanup();
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
