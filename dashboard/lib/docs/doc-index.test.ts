import { describe, expect, it } from "vitest";
import { resolveDocSlug } from "@/lib/docs/doc-index";

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
