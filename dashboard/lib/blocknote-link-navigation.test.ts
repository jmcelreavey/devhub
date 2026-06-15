import { describe, expect, it, vi } from "vitest";
import {
  handleBlockNoteLinkClick,
  isExternalHref,
  resolveInternalAppPath,
  shouldOpenInNewTab,
} from "./blocknote-link-navigation";

const docsContext = {
  vaultId: "docs" as const,
  contentSlug: "SUMMARY",
  currentPathname: "/docs/SUMMARY",
};

const notesContext = {
  vaultId: "notes" as const,
  contentSlug: "daily/2026-05-24",
  currentPathname: "/notes/daily/2026-05-24",
};

describe("blocknote-link-navigation", () => {
  it("detects external hrefs", () => {
    expect(isExternalHref("https://github.com/foo/bar")).toBe(true);
    expect(isExternalHref("mailto:hi@example.com")).toBe(true);
    expect(isExternalHref("/docs/SUMMARY")).toBe(false);
  });

  it("resolves absolute docs paths", () => {
    expect(resolveInternalAppPath("/docs/SUMMARY", notesContext)).toBe("/docs/SUMMARY");
    expect(resolveInternalAppPath("/docs/getting-started/installation.md", notesContext)).toBe(
      "/docs/getting-started/installation",
    );
  });

  it("resolves relative doc links from the current doc slug", () => {
    expect(resolveInternalAppPath("getting-started/installation.md", docsContext)).toBe(
      "/docs/getting-started/installation",
    );
  });

  it("resolves relative md links from notes as docs targets", () => {
    expect(resolveInternalAppPath("architecture/notes-system.md", notesContext)).toBe(
      "/docs/architecture/notes-system",
    );
  });

  it("resolves hash-only links against the current pathname", () => {
    expect(resolveInternalAppPath("#section", docsContext)).toBe("/docs/SUMMARY#section");
  });

  it("opens external links in a new tab", () => {
    const push = vi.fn();
    const openExternal = vi.fn();
    const event = { preventDefault: vi.fn(), metaKey: false, ctrlKey: false, shiftKey: false } as unknown as MouseEvent;

    handleBlockNoteLinkClick(
      event,
      "https://github.com/example-org/example-repo/pull/437",
      notesContext,
      { push, openExternal },
    );

    expect(openExternal).toHaveBeenCalledWith("https://github.com/example-org/example-repo/pull/437");
    expect(push).not.toHaveBeenCalled();
  });

  it("routes internal links through the app router", () => {
    const push = vi.fn();
    const openExternal = vi.fn();
    const event = { preventDefault: vi.fn(), metaKey: false, ctrlKey: false, shiftKey: false } as unknown as MouseEvent;

    handleBlockNoteLinkClick(event, "/docs/SUMMARY", notesContext, { push, openExternal });

    expect(push).toHaveBeenCalledWith("/docs/SUMMARY");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("respects modifier keys for internal links", () => {
    expect(
      shouldOpenInNewTab({ metaKey: true, ctrlKey: false, shiftKey: false } as MouseEvent),
    ).toBe(true);
    expect(
      shouldOpenInNewTab({ metaKey: false, ctrlKey: true, shiftKey: false } as MouseEvent),
    ).toBe(true);
  });
});
