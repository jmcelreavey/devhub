/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowUpdates } from "./WorkflowUpdates";

afterEach(cleanup);

const events = [
  { id: "1", at: "2026-10-16T12:51:00Z", summary: "review run: starting" },
  { id: "2", at: "2026-10-16T12:52:00Z", summary: "review run: running" },
  { id: "3", at: "2026-10-16T13:04:00Z", summary: "review run: completed" },
  { id: "4", at: "2026-10-16T13:04:00Z", summary: "review run: completed" },
  { id: "5", at: "2026-10-16T13:06:00Z", summary: "Verification started" },
  { id: "6", at: "2026-10-16T13:06:05Z", summary: "Verification command started" },
  { id: "7", at: "2026-10-16T13:07:00Z", summary: "Verification passed" },
];

describe("WorkflowUpdates", () => {
  it("shows the latest few in plain words with relative times, and Show all opens the grouped timeline", () => {
    render(<WorkflowUpdates events={events} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("span:not([aria-hidden])")?.textContent)).toEqual(["Checks passed", "Running the checks", "Verification started", "Review run finished"]);
    expect(items[0]!.querySelector("time")).toHaveAttribute("title", expect.stringContaining("2026"));
    fireEvent.click(screen.getByRole("button", { name: /^Show history \(\d+\)$/ }));
    const timeline = screen.getByLabelText("All updates");
    expect(within(timeline).getByText("Review run")).toBeTruthy();
    expect(within(timeline).getByText("Verification")).toBeTruthy();
    expect(within(timeline).getByText(/· passed/)).toBeTruthy();
    expect(within(timeline).getByText("Review run starting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show latest" }));
    expect(screen.queryByLabelText("All updates")).toBeNull();
  });

  it("has no Show all when everything already fits", () => {
    render(<WorkflowUpdates events={events.slice(0, 2)} />);
    expect(screen.queryByRole("button")).toBeNull();
    render(<WorkflowUpdates events={[]} />);
    expect(screen.getByText("Checks and decisions will appear here.")).toBeTruthy();
  });
});
