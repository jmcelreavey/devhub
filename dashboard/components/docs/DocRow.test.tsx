/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocRow, DocRowLink } from "@/components/docs/DocRow";

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

describe("DocRow context menu", () => {
  it("binds contextmenu on the row container with Open + Delete groups", () => {
    render(
      <DocRow
        doc={{ slug: "guides/skills", title: "Skills", href: "/docs/guides/skills" }}
        className="lib-recent-item"
      >
        <DocRowLink href="/docs/guides/skills" className="lib-recent-row">
          Skills
        </DocRowLink>
      </DocRow>,
    );

    const kebab = screen.getByRole("button", { name: "Actions for Skills" });
    expect(kebab.parentElement?.className).toContain("lib-recent-item");
    expect(kebab.className).toContain("row-menu-kebab");

    fireEvent.contextMenu(screen.getByText("Skills"), { clientX: 20, clientY: 24 });
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Open", hidden: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete doc", hidden: true })).toBeTruthy();
  });
});
