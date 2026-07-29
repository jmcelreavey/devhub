import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { getNoteIndex, invalidateNoteIndex } from "@/lib/notes/note-index";

const originalNotesDir = process.env.NOTES_DIR;
let root: string | null = null;

afterEach(() => {
  if (originalNotesDir === undefined) delete process.env.NOTES_DIR;
  else process.env.NOTES_DIR = originalNotesDir;
  invalidateNoteIndex();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

it("routes diagram JSON to the diagram editor", () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-note-index-"));
  fs.mkdirSync(path.join(root, "diagrams"));
  fs.writeFileSync(
    path.join(root, "diagrams", "system.json"),
    JSON.stringify({ type: "tldraw", version: 1, store: {} }),
  );
  process.env.NOTES_DIR = root;
  invalidateNoteIndex();

  expect(getNoteIndex().notes[0]).toMatchObject({
    slug: "diagrams/system",
    href: "/diagrams/system",
    isDiagram: true,
  });
});
