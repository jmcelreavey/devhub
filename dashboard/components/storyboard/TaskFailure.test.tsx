/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
const mocks = vi.hoisted(() => ({ recover: vi.fn(), live: vi.fn() }));
vi.mock("@/app/storyboard/board-actions", () => ({ recoverCardFailure: mocks.recover }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.live }));
vi.mock("@/lib/storyboard/task-action", () => ({ useTaskActionPending: () => false }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
import { TaskFailure } from "./TaskFailure";
const card = { taskId: "failed", failure: { key: "key", summary: "Plan failed", runId: "run" } } as BoardCard;
beforeEach(() => { vi.clearAllMocks(); mocks.recover.mockResolvedValue({ ok: true }); mocks.live.mockReturnValue({ data: { lines: ["Timed out rebuilding search"] } }); });
afterEach(cleanup);
it("offers retry, one guidance field, real logs and reversible clearing", async () => {
  const view = render(<TaskFailure card={card} profile="work" onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith(card, "retry", "work", undefined));
  fireEvent.click(screen.getByRole("button", { name: "Resume with guidance" }));
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Guidance for this retry"), { target: { value: "Increase the timeout" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith(card, "resume", "work", "Increase the timeout"));
  fireEvent.click(screen.getByRole("button", { name: "Open logs" }));
  expect(screen.getByLabelText("Run logs")).toHaveTextContent("Timed out rebuilding search");
  expect(mocks.live).toHaveBeenLastCalledWith("/api/tasks/failure/output?taskId=failed&taskProfile=work");
  fireEvent.click(screen.getByRole("button", { name: "Clear failure" }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith(card, "clear", "work", undefined));
  const cleared = { ...card, failure: { ...card.failure!, cleared: true } };
  view.rerender(<TaskFailure card={cleared} profile="work" onRefresh={vi.fn()} />);
  expect(screen.getAllByText("Failure cleared · auto paused")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Retry" })).not.toHaveClass("btn-primary");
  expect(screen.getByRole("button", { name: "Undo clear" })).toHaveTextContent("Undo");
  fireEvent.click(screen.getByRole("button", { name: "Undo clear" }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith(cleared, "restore", "work", undefined));
});
it("keeps guidance on a failed submission and opens logs directly from the menu", async () => {
  mocks.recover.mockResolvedValue({ ok: false, error: "Agent unavailable" });
  render(<TaskFailure card={card} profile="work" requestedSection="guidance" onRefresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Guidance for this retry"), { target: { value: "Keep this guidance" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox")).toHaveValue("Keep this guidance");
});

it("offers one-click refresh for a changed failure and drops the old error when the latest failure arrives", async () => {
  mocks.recover.mockResolvedValue({ ok: false, error: "The failure changed. Refresh before acting." });
  const onRefresh = vi.fn();
  const view = render(<TaskFailure card={card} profile="work" onRefresh={onRefresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear failure" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The failure changed");
  const refreshes = onRefresh.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(onRefresh).toHaveBeenCalledTimes(refreshes + 1);
  expect(mocks.recover).toHaveBeenCalledTimes(1);
  view.rerender(<TaskFailure card={{ ...card, failure: { ...card.failure!, key: "latest" } }} profile="work" onRefresh={onRefresh} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear failure" })).toBeEnabled();
});
