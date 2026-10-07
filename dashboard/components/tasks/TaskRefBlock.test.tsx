/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRefBlockView } from "./TaskRefBlock";

const mocks = vi.hoisted(() => ({
  useLive: vi.fn(),
  mutate: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.useLive }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: mocks.error }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("task note backlink", () => {
  it("shows and updates the current task when the note still names an old UUID and date", async () => {
    mocks.useLive.mockReturnValue({
      data: { date: "2026-09-24", tasks: [{ id: "current-id", text: "Current task title", done: false }] },
      mutate: mocks.mutate,
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    render(<TaskRefBlockView taskId="old-id" date="2026-09-23" label="Old title" />);
    expect(mocks.useLive).toHaveBeenCalledWith("/api/tasks?taskId=old-id", expect.any(Object));
    expect(screen.getByText("Current task title")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Work" }).getAttribute("href")).toBe("/work?date=2026-09-24");

    fireEvent.click(screen.getByRole("button", { name: "Mark task complete" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ id: "current-id", date: "2026-09-24", done: true }),
    })));
  });

  it("disables completion until the current task is loaded", () => {
    mocks.useLive.mockReturnValue({ data: undefined, mutate: mocks.mutate });
    render(<TaskRefBlockView taskId="old-id" date="2026-09-23" label="Task" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
