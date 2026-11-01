import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultStorage } from "../../domains/storage/vault";
import { jsonVaultCodec, markdownVaultCodec } from "./vault-codec";
import { applyVaultOrder } from "./vault-order";
import { ContentConflictError } from "../../../../../packages/shared/storage/content";
import { docsCreate, docsWrite, docsAppend, docsDelete } from "../../../../../packages/shared/actions/docs";
import { notesCreate, notesWrite, notesRename } from "../../../../../packages/shared/actions/notes";

describe("VaultStorage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-storage-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("checks content revisions across vault actions and folder mutations", async () => {
    const docs = new VaultStorage(tmp, markdownVaultCodec);
    const { file } = await docsCreate.handler({ path: "draft/doc", content: "original" }, docs);
    await docsWrite.handler({ path: "draft/doc", content: "newer", expectedRevision: file!.revision }, docs);
    await expect(docsWrite.handler({ path: "draft/doc", content: "stale", expectedRevision: file!.revision }, docs)).rejects.toBeInstanceOf(ContentConflictError);
    await expect(docsCreate.handler({ path: "draft/new", content: "created" }, docs)).resolves.toMatchObject({ existed: false });
    await expect(notesRename.handler({ path: "draft/doc", newPath: "moved", dir: false, expectedRevision: file!.revision }, docs)).rejects.toBeInstanceOf(ContentConflictError);
    await expect(docsDelete.handler({ path: "draft/doc", expectedRevision: file!.revision }, docs)).rejects.toBeInstanceOf(ContentConflictError);
    const folder = await docs.readDirectory("draft");
    await docsAppend.handler({ path: "draft/doc", content: "+append" }, docs);
    await expect(docs.renameDir("draft", "archive", folder!.revision)).rejects.toBeInstanceOf(ContentConflictError);
    await expect(docs.deleteDir("draft", folder!.revision)).rejects.toBeInstanceOf(ContentConflictError);
    await expect(docs.createDir("draft")).rejects.toBeInstanceOf(ContentConflictError);
    expect(docs.read("draft/doc")?.content).toBe("newer+append");
    const current = docs.read("draft/doc")!;
    await notesRename.handler({ path: "draft/doc", newPath: "archive/doc", dir: false, expectedRevision: current.revision }, docs);
    await docsDelete.handler({ path: "archive/doc", expectedRevision: current.revision }, docs);
    expect(docs.read("archive/doc")).toBeNull();

    const notes = new VaultStorage(tmp, jsonVaultCodec);
    const context = { storage: notes, mode: "markdown" as const };
    const created = await notesCreate.handler({ path: "note", content: "original" }, context);
    await notesWrite.handler({ path: "note", content: "newer", expectedRevision: created.file!.revision }, context);
    await expect(notesWrite.handler({ path: "note", content: "stale", expectedRevision: created.file!.revision }, context)).rejects.toBeInstanceOf(ContentConflictError);
    await expect(notes.write("note", [])).rejects.toBeInstanceOf(ContentConflictError);
  });

  it("reads and writes JSON notes", async () => {
    const storage = new VaultStorage(tmp, jsonVaultCodec);
    const blocks = [{ id: "1", type: "paragraph", content: [], children: [] }];
    await storage.write("daily/test", blocks);
    const read = storage.read("daily/test");
    expect(read).not.toBeNull();
    expect(read?.content).toEqual(blocks);
  });

  it("reads and writes markdown docs", async () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    await storage.write("guides/foo", "# Hello\n\nWorld");
    const read = storage.read("guides/foo");
    expect(read?.content).toBe("# Hello\n\nWorld");
    expect(fs.existsSync(path.join(tmp, "guides", "foo.md"))).toBe(true);
  });

  it("appends markdown docs via read/write", async () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    await storage.write("SUMMARY", "# Summary\n");
    const existing = storage.read("SUMMARY");
    await storage.write("SUMMARY", `${String(existing?.content)}\n- [Install](getting-started/installation.md)\n`, existing!.revision!);
    const read = storage.read("SUMMARY");
    expect(read?.content).toContain("getting-started/installation.md");
  });

  it("searches markdown docs", async () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    await storage.write("architecture/notes-system", "VaultStorage handles docs and notes.");
    await storage.write("README", "Welcome to DevHub.");
    const results = storage.searchText("VaultStorage");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("architecture/notes-system");
  });

  it("renames directories", async () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    await storage.write("learnings/typescript/generics", "# Generics");

    const result = await storage.renameDir("learnings/typescript", "archive/typescript");

    expect(result).toMatchObject({ path: "archive/typescript" });
    expect(fs.existsSync(path.join(tmp, "archive", "typescript", "generics.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "learnings", "typescript"))).toBe(false);
  });

  it("does not rename a directory into itself", async () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    await storage.write("learnings/typescript/generics", "# Generics");

    const result = await storage.renameDir("learnings", "learnings/archive");

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(tmp, "learnings", "typescript", "generics.md"))).toBe(true);
  });

  it("blocks path traversal", () => {
    const storage = new VaultStorage(tmp, markdownVaultCodec);
    expect(() => storage.read("../outside")).toThrow(/traversal/);
  });

  it("confines existing and new paths through symlinks to the vault", async () => {
    const root = path.join(tmp, "vault");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "existing.md"), "outside");
    fs.mkdirSync(path.join(outside, "folder"));
    fs.symlinkSync(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    const storage = new VaultStorage(root, markdownVaultCodec);

    expect(() => storage.read("link/existing")).toThrow(/traversal/);
    await expect(storage.write("link/new/note", "changed")).rejects.toThrow(/traversal/);
    expect(() => storage.list("link")).toThrow(/traversal/);
    await expect(storage.createDir("link/new")).rejects.toThrow(/traversal/);
    await expect(storage.deleteDir("link/folder")).rejects.toThrow(/traversal/);
    await expect(storage.renameDir("link/folder", "local")).rejects.toThrow(/traversal/);
    await storage.createDir("local");
    await expect(storage.renameDir("local", "link/new")).rejects.toThrow(/traversal/);
    expect(fs.readFileSync(path.join(outside, "existing.md"), "utf8")).toBe("outside");
    expect(fs.existsSync(path.join(outside, "new"))).toBe(false);
  });

  it("rejects a vault root replaced by an outside symlink", async () => {
    const root = path.join(tmp, "vault");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    const storage = new VaultStorage(root, markdownVaultCodec);
    fs.rmdirSync(root);
    fs.symlinkSync(outside, root, process.platform === "win32" ? "junction" : "dir");
    await expect(storage.write("note", "changed")).rejects.toThrow(/traversal/);
    expect(() => storage.list()).toThrow(/traversal/);
    expect(fs.existsSync(path.join(outside, "note.md"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("does not expose outside file symlinks or follow dangling links", async () => {
    const root = path.join(tmp, "vault");
    const outside = path.join(tmp, "outside.md");
    fs.mkdirSync(root);
    fs.writeFileSync(outside, "outside secret");
    fs.symlinkSync(outside, path.join(root, "link.md"));
    fs.symlinkSync(outside, path.join(root, ".devhub-order.json"));
    fs.symlinkSync(path.join(tmp, "missing"), path.join(root, "dangling"));
    const storage = new VaultStorage(root, markdownVaultCodec);

    expect(storage.list()).toEqual([]);
    expect(storage.searchText("secret")).toEqual([]);
    expect(() => storage.read("link")).toThrow(/traversal/);
    expect(() => applyVaultOrder([], root)).toThrow(/traversal/);
    await expect(storage.write("dangling/new", "changed")).rejects.toThrow(/traversal/);
  });
});
