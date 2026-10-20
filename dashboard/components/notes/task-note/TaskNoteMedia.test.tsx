/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaItem } from "@shared/task-note/sections.ts";
import { TaskNoteMedia } from "./TaskNoteMedia";

afterEach(cleanup);

const items: MediaItem[] = [
  { id: "1", kind: "image", url: "/api/notes-media/a.png", caption: "Before", name: "a.png", phase: "before" },
  { id: "2", kind: "video", url: "/api/notes-media/rec.webm", caption: "", name: "rec.webm" },
  { id: "3", kind: "image", url: "/api/notes-media/b.png", caption: "", name: "b.png" },
];

describe("TaskNoteMedia", () => {
  it("opens the clicked image in the shared viewer and browses the note's other images", () => {
    render(<TaskNoteMedia items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge: b.png" }));
    const dialog = screen.getByRole("dialog", { name: "Screenshots" });
    expect(within(dialog).getByText("2 / 2")).toBeTruthy();
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/notes-media/b.png");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("1 / 2")).toBeTruthy();
    expect(within(dialog).getByText("before")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
