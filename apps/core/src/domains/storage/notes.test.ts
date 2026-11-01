import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NotesStorage } from "./notes";

it("writes and reads image assets under the notes root", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-notes-assets-"));
  try {
    const storage = new NotesStorage(tmp);
    const rel = "garden/project/assets/photo-1.jpg";
    const bytes = Buffer.from("fake-jpeg");
    const written = await storage.writeAsset(rel, bytes);
    expect(written.path).toBe(rel);
    expect(storage.readAsset(rel)?.equals(bytes)).toBe(true);
    await expect(storage.writeAsset("daily/note.json", bytes)).rejects.toThrow(/\.json/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
