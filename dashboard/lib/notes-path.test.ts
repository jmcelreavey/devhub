import { describe, expect, it } from "vitest";
import {
  buildRenamedNotePath,
  isNotesPageActive,
  notesPageHref,
  slugFromNotesPathname,
} from "./notes-path";

describe("notes-path", () => {
  it("builds encoded hrefs for spaced segments", () => {
    expect(notesPageHref("garden/sloped weeds purge")).toBe(
      "/notes/garden/sloped%20weeds%20purge",
    );
  });

  it("matches active note routes with spaces", () => {
    expect(isNotesPageActive("/notes/garden/sloped%20weeds%20purge", "garden/sloped weeds purge")).toBe(
      true,
    );
    expect(isNotesPageActive("/notes/garden/sloped weeds purge", "garden/sloped weeds purge")).toBe(
      true,
    );
  });

  it("builds renamed paths in the same folder", () => {
    expect(buildRenamedNotePath("garden/sloped weeds purge", "Sloped Weeds Purge")).toBe(
      "garden/Sloped Weeds Purge",
    );
  });

  it("decodes note slugs from pathname", () => {
    expect(slugFromNotesPathname("/notes/garden/sloped%20weeds%20purge")).toBe(
      "garden/sloped weeds purge",
    );
  });
});
