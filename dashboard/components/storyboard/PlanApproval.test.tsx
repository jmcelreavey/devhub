/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { PlanApproval } from "./PlanApproval";
const mocks = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("@/app/storyboard/board-actions", () => ({ decidePlan: mocks.decide }));
vi.mock("@/lib/storyboard/task-action", () => ({ useTaskActionPending: () => false }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const card = { taskId: "task", auto: { planRunId: "plan-1" } } as BoardCard;

it("approves the current plan in one click and waits for refreshed state", async () => {
  mocks.decide.mockResolvedValue({ ok: true });
  const refresh = vi.fn();
  render(<PlanApproval card={card} profile="work" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.decide).toHaveBeenCalledWith(card, "approve", "work", undefined);
  expect(screen.getByRole("status")).toHaveTextContent("continuing on Auto");
});

it("keeps revision feedback on failure and resubmits it without approving", async () => {
  mocks.decide.mockResolvedValueOnce({ ok: false, error: "Plan changed; refresh." }).mockResolvedValue({ ok: true });
  render(<PlanApproval card={card} profile="work" onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Revise" }));
  expect(screen.getByRole("button", { name: "Send revision" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep the public API." } });
  fireEvent.click(screen.getByRole("button", { name: "Send revision" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox")).toHaveValue("Keep the public API.");
  fireEvent.click(screen.getByRole("button", { name: "Send revision" }));
  await screen.findByRole("status");
  expect(mocks.decide).toHaveBeenLastCalledWith(card, "revise", "work", "Keep the public API.");
});

it("opens the feedback field directly from a card's Revise action", () => {
  render(<PlanApproval card={card} revise onRefresh={vi.fn()} />);
  expect(screen.getByRole("textbox")).toHaveFocus();
});

it("reports approval correctly even while the revision field is open", async () => {
  mocks.decide.mockResolvedValue({ ok: true });
  render(<PlanApproval card={card} revise onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Plan approved");
});
