/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DependencyChecklist } from "@/components/setup/DependencyChecklist";
import { TERMINAL_PROPOSE_EVENT } from "@/lib/terminal-inject";
import type { DependencyReport } from "@/lib/setup/dependencies";

const report: DependencyReport = {
  tools: [
    {
      id: "git",
      label: "Git",
      required: true,
      unlocks: "Reading your repositories",
      present: true,
      version: "git version 2.55.0",
    },
    {
      id: "gh",
      label: "GitHub CLI",
      required: false,
      unlocks: "Pull requests, cloning, and repository search",
      present: false,
      version: null,
      installCommand: "brew install gh",
    },
    {
      id: "cursor",
      label: "Cursor",
      required: false,
      unlocks: "Opening a repository straight into the editor",
      present: false,
      version: null,
      installUrl: "https://cursor.com",
    },
  ],
  ready: true,
  missingRequired: [],
  availableCount: 1,
  totalCount: 3,
};

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => ({ data: report, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

afterEach(cleanup);

describe("DependencyChecklist install actions", () => {
  it("offers Install only for tools that have a command to run", () => {
    render(<DependencyChecklist />);
    // Cursor is missing too, but it's a GUI download — an Install button there
    // would propose a command that does not exist.
    expect(screen.getAllByRole("button", { name: /install/i })).toHaveLength(1);
  });

  it("proposes the install command to the terminal rather than running it", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(TERMINAL_PROPOSE_EVENT, listener);

    render(<DependencyChecklist />);
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    window.removeEventListener(TERMINAL_PROPOSE_EVENT, listener);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ command: "brew install gh", label: "Install GitHub CLI" });
  });

  it("keeps the command visible next to the button", () => {
    render(<DependencyChecklist />);
    // Running something on the user's machine behind a button labelled
    // "Install" without showing what it runs would be worse than copy-paste.
    expect(screen.getByText("brew install gh")).toBeTruthy();
  });

  it("can re-check after an install finishes in the terminal", () => {
    render(<DependencyChecklist />);
    expect(screen.getByRole("button", { name: /re-check/i })).toBeTruthy();
  });
});
