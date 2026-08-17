/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryNav, type LibraryNavGroup } from "@/components/library/LibraryNav";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notes/daily/standup",
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

const groups: LibraryNavGroup[] = [
  {
    id: "daily",
    label: "Daily",
    deletable: true,
    items: [{ slug: "daily/standup", title: "Standup", href: "/notes/daily/standup" }],
  },
];

describe("LibraryNav context menu", () => {
  it("binds contextmenu on the note row container with Open + Delete groups", () => {
    render(
      <LibraryNav
        groups={groups}
        search=""
        basePath="/notes/area"
        storageKey="test:notes-nav"
        label="Notes"
        noun="notes"
        kind="notes"
        onDeleteGroup={vi.fn()}
      />,
    );

    const kebab = screen.getByRole("button", { name: "Actions for Standup" });
    const row = kebab.parentElement;
    expect(row?.className).toContain("lib-nav-item");
    expect(row?.contains(kebab)).toBe(true);

    fireEvent.contextMenu(screen.getByText("Standup"), { clientX: 16, clientY: 32 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Open", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete note", hidden: true })).toBeTruthy();
  });

  it("puts folder delete in the danger group and drops the leftover trash icon", () => {
    render(
      <LibraryNav
        groups={groups}
        search=""
        basePath="/notes/area"
        storageKey="test:notes-nav-folder"
        label="Notes"
        noun="notes"
        kind="notes"
        onDeleteGroup={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete folder Daily" })).toBeNull();
    fireEvent.contextMenu(screen.getByText("Daily"), { clientX: 10, clientY: 12 });
    expect(screen.getByRole("menuitem", { name: "New note here", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete folder", hidden: true })).toBeTruthy();
  });

  it("binds contextmenu on a docs row with Open + Delete groups", () => {
    render(
      <LibraryNav
        groups={[
          {
            id: "guides",
            label: "Guides",
            deletable: true,
            items: [{ slug: "guides/skills", title: "Skills", href: "/docs/guides/skills" }],
          },
        ]}
        search=""
        basePath="/docs"
        storageKey="test:docs-nav"
        label="Docs"
        noun="docs"
        kind="docs"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Guides" }));

    const kebab = screen.getByRole("button", { name: "Actions for Skills" });
    expect(kebab.parentElement?.className).toContain("lib-nav-item");

    fireEvent.contextMenu(screen.getByText("Skills"), { clientX: 16, clientY: 32 });
    expect(screen.getByRole("menuitem", { name: "Open", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete doc", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Open in Cursor/, hidden: true })).toBeDisabled();
  });
});
