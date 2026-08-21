import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkoutRoot = { current: "" as string };

vi.mock("@/lib/desktop/runtime-paths", () => ({
  getCheckoutRoot: () => checkoutRoot.current || null,
}));

vi.mock("@/lib/content/dirs", () => ({
  getNotesDir: () => path.join(checkoutRoot.current, "notes"),
  getDocsDir: () => path.join(checkoutRoot.current, "docs"),
}));

describe("resolveVaultGitPath", () => {
  beforeEach(() => {
    checkoutRoot.current = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-vault-hist-"));
    fs.mkdirSync(path.join(checkoutRoot.current, "notes"), { recursive: true });
    fs.mkdirSync(path.join(checkoutRoot.current, "docs"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(checkoutRoot.current, { recursive: true, force: true });
    checkoutRoot.current = "";
    vi.resetModules();
  });

  it("maps a note slug to notes/<slug>.json under the checkout", async () => {
    const { resolveVaultGitPath } = await import("./file-history");
    expect(resolveVaultGitPath("notes", "daily/2026-08-20")).toEqual({
      checkoutRoot: checkoutRoot.current,
      repoRelPath: "notes/daily/2026-08-20.json",
    });
  });

  it("maps a doc slug to docs/<slug>.md", async () => {
    const { resolveVaultGitPath } = await import("./file-history");
    expect(resolveVaultGitPath("docs", "guides/plugins")).toEqual({
      checkoutRoot: checkoutRoot.current,
      repoRelPath: "docs/guides/plugins.md",
    });
  });

  it("rejects path traversal", async () => {
    const { resolveVaultGitPath } = await import("./file-history");
    expect(resolveVaultGitPath("notes", "../secrets")).toBeNull();
  });

  it("returns null when there is no checkout", async () => {
    checkoutRoot.current = "";
    const { resolveVaultGitPath } = await import("./file-history");
    expect(resolveVaultGitPath("notes", "index")).toBeNull();
  });
});
