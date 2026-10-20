/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotesOverlay } from "./NotesOverlay";

const state = vi.hoisted(() => ({ push: vi.fn(), mobile: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/hooks/use-is-mobile", () => ({ isMobileViewport: () => state.mobile }));
vi.mock("@/components/BlockNoteEditor", () => ({ BlockNoteEditor: () => null }));
vi.mock("@/components/FileTree", () => ({ FileTree: () => null }));
vi.mock("@/components/NewNotePathModal", () => ({ NewNotePathModal: () => null }));
vi.mock("@/components/ui/CopyLocationButton", () => ({ CopyLocationButton: () => null }));
vi.mock("@/components/shell/SidePanel", () => ({ SidePanel: ({ open, ariaLabel, children }: { open: boolean; ariaLabel: string; children: React.ReactNode }) => open ? <aside aria-label={ariaLabel}>{children}</aside> : null }));
vi.mock("@/components/vault/VaultEditorPage", () => ({ VaultEditorPage: ({ path, embedded }: { path: string[]; embedded?: boolean }) => <div data-testid="editor" data-path={path.join("/")} data-embedded={String(!!embedded)} /> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); state.mobile = false; });

it("opens a requested task note in the panel with the task-note editor and a full-page escape", () => {
  const onClose = vi.fn();
  const view = render(<NotesOverlay open onClose={onClose} notePathRequest={{ path: "task-notes/fix-login", id: 1 }} />);
  expect(screen.getByRole("complementary", { name: "Note editor" })).toBeInTheDocument();
  expect(screen.getByTestId("editor")).toHaveAttribute("data-path", "task-notes/fix-login");
  expect(screen.getByTestId("editor")).toHaveAttribute("data-embedded", "true");
  expect(screen.getByText("fix-login")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open in full page" }));
  expect(onClose).toHaveBeenCalled();
  expect(state.push).toHaveBeenCalledWith("/notes/task-notes/fix-login");
  view.rerender(<NotesOverlay open onClose={onClose} notePathRequest={{ path: "task-notes/other", id: 2 }} />);
  expect(screen.getByTestId("editor")).toHaveAttribute("data-path", "task-notes/other");
  fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
  expect(screen.queryByTestId("editor")).toBeNull();
});

it("uses the full-page editor on phones", () => {
  state.mobile = true;
  render(<NotesOverlay open onClose={vi.fn()} notePathRequest={{ path: "task-notes/fix-login", id: 1 }} />);
  expect(state.push).toHaveBeenCalledWith("/notes/task-notes/fix-login");
});
