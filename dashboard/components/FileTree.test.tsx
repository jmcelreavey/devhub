/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/FileTree";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/notes",
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

const tree = [
  {
    type: "dir" as const,
    name: "daily",
    path: "daily",
    children: [
      { type: "file" as const, name: "standup.json", path: "daily/standup.json" },
    ],
  },
  { type: "file" as const, name: "inbox-note.json", path: "inbox-note.json" },
];

describe("FileTree context menu", () => {
  it("binds contextmenu on the file row container and shows Open + Delete groups", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => tree,
        text: async () => "",
      }),
    );

    render(<FileTree vault="notes" />);
    const kebab = await screen.findByRole("button", { name: "Actions for inbox-note" });
    const row = kebab.parentElement;
    expect(row).toBeTruthy();
    expect(row?.className).toContain("group");
    expect(row?.contains(kebab)).toBe(true);

    fireEvent.contextMenu(row as HTMLElement, { clientX: 24, clientY: 40 });
    // One ContextMenu per TreeNode — pick this row's, not the folder's closed popover.
    const menu = document.querySelector('[aria-label="inbox-note actions"]');
    expect(menu).toBeTruthy();
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.textContent).toContain("Open");
    expect(menu?.textContent).toContain("Delete note");

    vi.unstubAllGlobals();
  });

  it("keeps New + Delete on a folder row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => tree,
        text: async () => "",
      }),
    );

    render(<FileTree vault="notes" />);
    const kebab = await screen.findByRole("button", { name: "Actions for daily" });
    fireEvent.contextMenu(kebab.parentElement as HTMLElement, { clientX: 12, clientY: 20 });
    const menu = document.querySelector('[aria-label="daily actions"]');
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.textContent).toContain("New note here");
    expect(menu?.textContent).toContain("Delete folder");

    vi.unstubAllGlobals();
  });
});

describe("FileTree docs kind", () => {
  it("labels delete as a doc, not a note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ type: "file" as const, name: "intro.md", path: "intro.md" }],
        text: async () => "",
      }),
    );

    render(<FileTree vault="docs" />);
    const kebab = await screen.findByRole("button", { name: "Actions for intro" });
    fireEvent.contextMenu(kebab.parentElement as HTMLElement, { clientX: 8, clientY: 8 });
    const menu = document.querySelector('[aria-label="intro actions"]');
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(menu?.textContent).toContain("Delete doc");
    expect(menu?.textContent).not.toContain("Delete note");
    expect(menu?.textContent).not.toContain("Open in Cursor");

    vi.unstubAllGlobals();
  });
});
