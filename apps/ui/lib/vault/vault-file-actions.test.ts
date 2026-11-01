import { describe, expect, it } from "vitest";
import {
  duplicateSlug,
  fileKindForRow,
  siblingRenamePath,
  vaultFolderPath,
  vaultIdForKind,
} from "./vault-file-actions";

describe("duplicateSlug", () => {
  it("appends -copy to a plain slug", () => {
    expect(duplicateSlug("daily/standup")).toBe("daily/standup-copy");
  });

  it("increments an existing -copy suffix", () => {
    expect(duplicateSlug("daily/standup-copy")).toBe("daily/standup-copy-2");
    expect(duplicateSlug("daily/standup-copy-2")).toBe("daily/standup-copy-3");
  });
});

describe("fileKindForRow", () => {
  it("keeps docs and notes as-is", () => {
    expect(fileKindForRow("docs", "guides/intro")).toBe("docs");
    expect(fileKindForRow("notes", "daily/2026-08-14")).toBe("notes");
  });

  it("treats diagram paths as diagrams even on the notes nav", () => {
    expect(fileKindForRow("notes", "diagrams/foo", "/diagrams/foo")).toBe("diagrams");
    expect(fileKindForRow("diagrams", "diagrams/foo")).toBe("diagrams");
  });
});

describe("vaultIdForKind", () => {
  it("maps diagrams onto the notes vault", () => {
    expect(vaultIdForKind("notes")).toBe("notes");
    expect(vaultIdForKind("diagrams")).toBe("notes");
    expect(vaultIdForKind("docs")).toBe("docs");
  });
});

describe("vaultFolderPath", () => {
  it("prefixes diagram areas with diagrams/", () => {
    expect(vaultFolderPath("diagrams", "Acme")).toBe("diagrams/Acme");
    expect(vaultFolderPath("diagrams", "")).toBe("diagrams");
    expect(vaultFolderPath("docs", "guides")).toBe("guides");
  });
});

describe("siblingRenamePath", () => {
  it("keeps the parent folder", () => {
    expect(siblingRenamePath("diagrams/Acme/Reports", "Archive")).toBe("diagrams/Acme/Archive");
    expect(siblingRenamePath("guides", "howto")).toBe("howto");
  });
});
