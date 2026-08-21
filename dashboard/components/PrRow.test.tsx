/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrRow } from "@/components/PrRow";
import type { GithubPrRow } from "@/lib/github/prs";

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

const row: GithubPrRow = {
  repo: "example-org/example-service",
  number: 123,
  title: "ABC-123 - Example change",
  url: "https://github.com/example-org/example-service/pull/123",
  author: { login: "you", avatarUrl: "https://example.com/you.png" },
};

describe("PrRow", () => {
  it("keeps context on the meta line and every action behind the kebab", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<PrRow row={row} kind="authored" density="compact" />);

    const meta = document.querySelector("[data-pr-meta]");
    const actions = document.querySelector("[data-pr-actions]");
    expect(meta).toBeTruthy();
    expect(actions).toBeTruthy();

    expect(meta?.textContent).toContain("example-org/example-service#123");
    expect(actions?.querySelector('[aria-label="Actions for example-org/example-service#123"]')).toBeTruthy();

    expect(screen.queryByRole("button", { name: /copy request/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /request review/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open in cursor/i })).toBeNull();

    vi.unstubAllGlobals();
  });
});
