/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagramFileCard, DiagramFolderCard } from "@/components/diagrams/DiagramCards";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/components/shell/ConfirmDialog", () => ({
  useConfirm: () => vi.fn(),
  usePrompt: () => vi.fn(),
}));

vi.mock("@/components/OneTimeShareButton", () => ({
  OneTimeShareButton: () => null,
}));

vi.mock("@/components/InlineNoteRename", () => ({
  InlineNoteRename: ({ displayName }: { displayName: string }) => <span>{displayName}</span>,
}));

describe("DiagramCards context menu", () => {
  it("binds contextmenu on the file card with Open + Delete groups", () => {
    const { container } = render(
      <DiagramFileCard
        file={{ path: "diagrams/Acme/flow", name: "flow" }}
        thumbnail={<div>thumb</div>}
        onChanged={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    const card = container.querySelector(".card");
    expect(card).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for flow" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByText("flow"), { clientX: 16, clientY: 32 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Open", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete diagram", hidden: true })).toBeTruthy();
  });

  it("binds contextmenu on the folder card with New + Delete", () => {
    render(
      <DiagramFolderCard
        folder={{ relPath: "Acme", name: "Acme", storagePath: "diagrams/Acme" }}
        onOpen={vi.fn()}
        onChanged={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText("Acme"), { clientX: 10, clientY: 12 });
    expect(screen.getByRole("menuitem", { name: "New diagram here", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete folder", hidden: true })).toBeTruthy();
  });
});
