/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityLinkChips } from "@/components/EntityLinkChips";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EntityLinkChips repo navigation", () => {
  it("renders a repo chip as a link to the repo hub", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], related: [] }),
      }),
    );

    render(
      <EntityLinkChips
        kind="task"
        id="task-1"
        seed={[{ kind: "repo", id: "app-poc", label: "app-poc" }]}
      />,
    );

    const link = await screen.findByRole("link", { name: "app-poc" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/repos/app-poc");
  });
});
