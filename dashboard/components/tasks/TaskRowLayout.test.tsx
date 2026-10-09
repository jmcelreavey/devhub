/** @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SharedEntityChips } from "@/components/EntityLinkChips";
import type { EntityRef } from "@/lib/entity-note";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const repos: EntityRef[] = [
  { kind: "repo", id: "org/app", label: "app" },
  { kind: "repo", id: "org/github-configuration", label: "GitHub configuration" },
  { kind: "repo", id: "org/terraform-github-repositories", label: "terraform-github-repositories" },
];

describe("SharedEntityChips overflow", () => {
  it("shows every chip when no max is set", () => {
    render(<SharedEntityChips refs={repos} label="Linked repos" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  it("collapses the remainder into a +N chip that names what it hides", () => {
    render(<SharedEntityChips refs={repos} label="Linked repos" max={1} />);
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.queryByText("GitHub configuration")).toBeNull();
    const more = screen.getByText("+2");
    expect(more.getAttribute("title")).toContain("GitHub configuration");
    expect(more.getAttribute("title")).toContain("terraform-github-repositories");
  });
});

/**
 * Layout guards. jsdom can't lay anything out, so these read the stylesheet:
 * the PTF-5195 bug was a never-shrinking rail plus a title column with no
 * floor, so the key chip overpainted the CI badge and the title went one
 * letter per line.
 */
const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no standalone rule for ${selector}`);
  return match[1];
}

describe("task row layout", () => {
  it("wraps the rail instead of squeezing the title column", () => {
    expect(rule(".task-row")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("gives the key + title column a minimum width", () => {
    expect(rule(".task-row-content")).toMatch(/min-width:\s*min\(\s*14rem\s*,\s*100%\s*\)/);
  });

  it("lets the rail and its meta cluster shrink and wrap rather than overflow", () => {
    const actions = rule(".task-row-actions");
    expect(actions).toMatch(/flex-wrap:\s*wrap/);
    expect(actions).toMatch(/min-width:\s*0/);
    expect(actions).not.toMatch(/flex-shrink:\s*0/);
    const meta = rule(".task-row-meta");
    expect(meta).toMatch(/flex-wrap:\s*wrap/);
    expect(meta).not.toMatch(/flex-shrink:\s*0/);
  });
});
