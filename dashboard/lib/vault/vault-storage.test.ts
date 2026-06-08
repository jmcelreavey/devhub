import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultStorage } from "@/lib/vault/vault-storage";
import { jsonVaultCodec, markdownVaultCodec } from "@/lib/vault/vault-codec";

describe("VaultStorage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-storage-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads and writes JSON notes", () => {
    const storage = new VaultStorage(tmp, jsonVaultCodec);
    const blocks = [{ id: "1", type: "paragraph", content: [], children: [] }];
    storage.write("daily/test", blocks);
    const read = storage.read("daily/test");
    expect(read).not.toBeNull();
    expect(read?.content).toEqual(blocks);
  });

  it("reads and writes markdown docs", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    storage.write("guides/foo", "# Hello\n\nWorld");
    const read = storage.read("guides/foo");
    expect(read?.content).toBe("# Hello\n\nWorld");
    expect(fs.existsSync(path.join(tmp, "guides", "foo.md"))).toBe(true);
  });

  it("appends markdown docs via read/write", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    storage.write("SUMMARY", "# Summary\n");
    const existing = storage.read("SUMMARY");
    storage.write("SUMMARY", `${String(existing?.content)}\n- [Install](getting-started/installation.md)\n`);
    const read = storage.read("SUMMARY");
    expect(read?.content).toContain("getting-started/installation.md");
  });

  it("searches markdown docs", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    storage.write("architecture/notes-system", "VaultStorage handles docs and notes.");
    storage.write("README", "Welcome to DevHub.");
    const results = storage.searchText("VaultStorage");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("architecture/notes-system");
  });

  it("renames directories", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    storage.write("learnings/typescript/generics", "# Generics");

    const result = storage.renameDir("learnings/typescript", "archive/typescript");

    expect(result).toEqual({ path: "archive/typescript" });
    expect(fs.existsSync(path.join(tmp, "archive", "typescript", "generics.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "learnings", "typescript"))).toBe(false);
  });

  it("does not rename a directory into itself", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    storage.write("learnings/typescript/generics", "# Generics");

    const result = storage.renameDir("learnings", "learnings/archive");

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(tmp, "learnings", "typescript", "generics.md"))).toBe(true);
  });

  it("blocks path traversal", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    expect(() => storage.read("../outside")).toThrow(/traversal/);
  });
});
