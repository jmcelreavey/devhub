/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayMainCard } from "@/components/today/TodayMainCard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/tasks/TaskList", () => ({
  TaskList: () => null,
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    function MockDynamic() {
      return null;
    }
    return MockDynamic;
  },
}));

afterEach(cleanup);

const base = {
  onTabChange: () => undefined,
  mainCollapsed: false,
  onToggleCollapsed: () => undefined,
  mainCollapsedSummary: "",
  status: "idle" as const,
  tasksTotal: 0,
  tasksDone: 0,
  onClearNote: () => undefined,
  blocks: null,
  noteEditorKey: 0,
  todayPath: "daily/2026-08-27",
  onNoteChange: () => undefined,
};

describe("TodayMainCard View all", () => {
  it("opens the work tasks page from the tasks tab", () => {
    render(<TodayMainCard {...base} tab="tasks" />);
    expect(screen.getByRole("link", { name: "View all →" }).getAttribute("href")).toBe("/work?tab=tasks");
  });

  it("opens notes from the notes tab", () => {
    render(<TodayMainCard {...base} tab="notes" />);
    expect(screen.getByRole("link", { name: "View all →" }).getAttribute("href")).toBe("/notes");
  });
});
