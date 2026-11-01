import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendContent, ContentConflictError } from "./content.ts";
import { createFileContentStorage } from "./file-content.ts";

const directories: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-content-"));
  directories.push(root);
  return createFileContentStorage(root);
}
afterEach(() => { for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("file content storage", () => {
  it("rejects stale revisions without overwriting newer content", async () => {
    const store = fixture();
    const original = await store.write("note.md", "original", null);
    await store.write("note.md", "newer", original.revision);
    await expect(store.write("note.md", "stale", original.revision)).rejects.toBeInstanceOf(ContentConflictError);
    expect((await store.read("note.md"))?.content.toString()).toBe("newer");
  });

  it("retries an append when another writer changes the same file", async () => {
    const store = fixture();
    await store.write("note.md", "start", null);
    await Promise.all([
      appendContent(store, "note.md", "+one"),
      appendContent(store, "note.md", "+two"),
    ]);
    const content = (await store.read("note.md"))?.content.toString();
    expect(["start+one+two", "start+two+one"]).toContain(content);
  });
});
