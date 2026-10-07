import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDocsDir } from "@/lib/content/dirs";
import { getDocIndex, getRecentDocs, invalidateDocIndex, resolveDocSlug } from "@/lib/docs/doc-index";

vi.mock("@/lib/content/dirs", () => ({ getDocsDir: vi.fn() }));

describe("recent docs", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-recency-"));
    vi.mocked(getDocsDir).mockReturnValue(root);
    invalidateDocIndex();
    for (const [slug, modified, draft] of [
      ["guides/current", 1000, false],
      ["plans/proposed", 2000, false],
      ["archive/finished", 3000, false],
      ["guides/draft", 4000, true],
    ] as const) {
      const file = path.join(root, `${slug}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `---\ntitle: ${slug}\ndescription: Test page\ndraft: ${draft}\n---\n# Test page\n`);
      fs.utimesSync(file, modified, modified);
    }
  });

  afterEach(() => {
    invalidateDocIndex();
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it("fills the recent list with current guidance while retaining plans in the index", () => {
    expect(getRecentDocs(1).map((doc) => doc.slug)).toEqual(["guides/current"]);
    expect(getDocIndex().sections.map((section) => section.meta.id)).toEqual([
      "guides", "plans", "archive",
    ]);
  });
});

const known = new Set([
  "README",
  "architecture/overview",
  "architecture/dashboard",
  "guides/theming",
  "guides/plugins/authoring",
  "archive/README",
]);

describe("resolveDocSlug", () => {
  it("resolves a sibling relative link", () => {
    expect(resolveDocSlug("dashboard.md", "architecture/overview", known)).toBe(
      "architecture/dashboard",
    );
  });

  it("resolves a parent-relative link that stays inside docs", () => {
    expect(resolveDocSlug("../guides/theming.md", "architecture/overview", known)).toBe(
      "guides/theming",
    );
  });

  it("resolves an app-absolute /docs href", () => {
    expect(resolveDocSlug("/docs/guides/theming", "README", known)).toBe("guides/theming");
  });

  it("ignores the hash fragment", () => {
    expect(resolveDocSlug("theming.md#tokens", "guides/plugins/authoring", known)).toBeNull();
    expect(resolveDocSlug("../theming.md#tokens", "guides/plugins/authoring", known)).toBe(
      "guides/theming",
    );
  });

  it("returns null for links that escape the docs tree", () => {
    expect(resolveDocSlug("../CONTRIBUTING.md", "README", known)).toBeNull();
  });

  it("returns null for external and protocol links", () => {
    expect(resolveDocSlug("https://example.com", "README", known)).toBeNull();
    expect(resolveDocSlug("mailto:a@b.c", "README", known)).toBeNull();
  });

  it("returns null for other app routes", () => {
    expect(resolveDocSlug("/notes/foo", "README", known)).toBeNull();
  });

  it("returns null for a bare in-page anchor", () => {
    expect(resolveDocSlug("#tokens", "guides/theming", known)).toBeNull();
  });

  it("falls back to a folder index doc", () => {
    expect(resolveDocSlug("archive", "README", known)).toBe("archive/README");
  });

  it("returns null for an unknown target", () => {
    expect(resolveDocSlug("guides/missing.md", "README", known)).toBeNull();
  });
});
