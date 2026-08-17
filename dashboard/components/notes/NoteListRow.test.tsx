/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteListRow } from "@/components/notes/NoteListRow";

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

describe("NoteListRow", () => {
  it("opens the menu from the row container with Open + Delete", () => {
    render(
      <NoteListRow
        note={{ slug: "daily/standup", href: "/notes/daily/standup", title: "Standup" }}
        className="lib-recent-row"
      >
        Standup
      </NoteListRow>,
    );

    const kebab = screen.getByRole("button", { name: "Actions for Standup" });
    fireEvent.contextMenu(screen.getByText("Standup"), { clientX: 20, clientY: 24 });
    expect(document.querySelector(".context-menu")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Open", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete note", hidden: true })).toBeTruthy();
    expect(kebab.className).toContain("row-menu-kebab");
  });
});
