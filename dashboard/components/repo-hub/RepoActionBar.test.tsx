/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoActionBar } from "./RepoActionBar";
import type { RepoInfo } from "@/app/repos/types";
import type { useReposActions } from "@/app/repos/useReposActions";

vi.mock("@/lib/launch/chamber", () => ({ useLaunchChamberDesktop: () => vi.fn() }));
vi.mock("@/lib/launch/chatgpt", () => ({ useLaunchChatGPTDesktop: () => vi.fn() }));
vi.mock("@/lib/launch/claude", () => ({ useLaunchClaudeDesktop: () => vi.fn() }));
vi.mock("@/lib/launch/cursor", () => ({ useLaunchCursorDesktop: () => vi.fn() }));
vi.mock("@/lib/terminal-launch", () => ({
  openTerminal: vi.fn(),
  chatgptCliCommand: () => "chatgpt",
  claudeCliCommand: () => "claude",
  opencodeCliCommand: () => "opencode",
}));

const repo: RepoInfo = {
  name: "acme-api",
  path: "/repos/acme-api",
  branch: "main",
  dirtyCount: 0,
  remote: null,
};

function mockActions() {
  return {
    openUpstart: vi.fn(),
    openInTerminal: vi.fn(),
    openInCursor: vi.fn(),
  } as unknown as ReturnType<typeof useReposActions> & {
    openUpstart: ReturnType<typeof vi.fn>;
    openInTerminal: ReturnType<typeof vi.fn>;
    openInCursor: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
});

describe("RepoActionBar hotkeys", () => {
  it("shows the chords on Upstart and Terminal", () => {
    render(<RepoActionBar repo={repo} actions={mockActions()} />);
    expect(screen.getByRole("button", { name: "Run upstart" }).getAttribute("title")).toBe("Upstart ⌘⏎");
    expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("title")).toBe("Terminal ⌘⇧T");
  });

  it("⌘Enter calls upstart for this repo", () => {
    const actions = mockActions();
    render(<RepoActionBar repo={repo} actions={actions} />);
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(actions.openUpstart).toHaveBeenCalledWith(repo);
    expect(actions.openInTerminal).not.toHaveBeenCalled();
  });

  it("⌘⇧T opens a shell terminal with this repo cwd", () => {
    const actions = mockActions();
    render(<RepoActionBar repo={repo} actions={actions} />);
    fireEvent.keyDown(document, { key: "t", metaKey: true, shiftKey: true });
    expect(actions.openInTerminal).toHaveBeenCalledWith(repo);
    expect(actions.openInTerminal.mock.calls[0]?.[0].path).toBe("/repos/acme-api");
    expect(actions.openUpstart).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter / Ctrl+Shift+T work the same as the Meta chords", () => {
    const actions = mockActions();
    render(<RepoActionBar repo={repo} actions={actions} />);
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(document, { key: "t", ctrlKey: true, shiftKey: true });
    expect(actions.openUpstart).toHaveBeenCalledTimes(1);
    expect(actions.openInTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not steal ⌘T (tasks) or fire from a text field", () => {
    const actions = mockActions();
    render(
      <>
        <RepoActionBar repo={repo} actions={actions} />
        <input data-testid="field" />
      </>,
    );
    fireEvent.keyDown(document, { key: "t", metaKey: true });
    expect(actions.openInTerminal).not.toHaveBeenCalled();

    const field = screen.getByTestId("field");
    field.focus();
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    fireEvent.keyDown(field, { key: "t", metaKey: true, shiftKey: true });
    expect(actions.openUpstart).not.toHaveBeenCalled();
    expect(actions.openInTerminal).not.toHaveBeenCalled();
  });

  it("does not fire while the command palette or a dialog is open", () => {
    const paletteActions = mockActions();
    render(
      <>
        <div aria-label="Command palette" />
        <RepoActionBar repo={repo} actions={paletteActions} />
      </>,
    );
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(paletteActions.openUpstart).not.toHaveBeenCalled();
    cleanup();

    const dialogActions = mockActions();
    render(<RepoActionBar repo={repo} actions={dialogActions} />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(dialogActions.openUpstart).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("uses the visible workspace tab, not a hidden keep-alive repo", () => {
    const hiddenRepo: RepoInfo = { ...repo, name: "other", path: "/repos/other" };
    const visible = mockActions();
    const hidden = mockActions();
    render(
      <>
        <div data-workspace-tab-panel="hidden" hidden>
          <RepoActionBar repo={hiddenRepo} actions={hidden} />
        </div>
        <div data-workspace-tab-panel="visible">
          <RepoActionBar repo={repo} actions={visible} />
        </div>
      </>,
    );
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    fireEvent.keyDown(document, { key: "t", metaKey: true, shiftKey: true });
    expect(visible.openUpstart).toHaveBeenCalledWith(repo);
    expect(visible.openInTerminal).toHaveBeenCalledWith(repo);
    expect(hidden.openUpstart).not.toHaveBeenCalled();
    expect(hidden.openInTerminal).not.toHaveBeenCalled();
  });
});
