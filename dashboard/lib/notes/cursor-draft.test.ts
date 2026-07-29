import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import {
  applyCursorDraft,
  createCursorDraft,
  CursorDraftError,
  deleteCursorDraft,
  markCursorDraftApplied,
} from "./cursor-draft";

describe("Cursor note working copies", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cursor-draft-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("exports readable Markdown and applies edited content", () => {
    const source = textToBlocks("# Review\n\nOriginal note");
    const { markdownPath: draftPath, writable } = createCursorDraft(
      "devhub",
      "daily/review",
      source,
      "/vault/notes",
      root,
    );
    expect(writable).toBe(true);
    const draft = fs.readFileSync(draftPath, "utf8");
    expect(draft).toContain("DEVHUB NOTE WORKING COPY");
    expect(draft).toContain("Source note: daily/review");
    expect(draft).toContain("Original note");

    fs.writeFileSync(draftPath, draft.replace("Original note", "Updated from Cursor"));
    const updated = applyCursorDraft("devhub", "daily/review", source, "/vault/notes", root);
    expect(blocksToText(updated)).toContain("Updated from Cursor");

    markCursorDraftApplied("devhub", "daily/review", updated, "/vault/notes", root);
    expect(() =>
      applyCursorDraft("devhub", "daily/review", updated, "/vault/notes", root),
    ).not.toThrow();
  });

  it("refuses to overwrite a note changed after export", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("devhub", "daily/review", source, "/vault/notes", root);
    fs.appendFileSync(draft.markdownPath, "\nPersistent Cursor note");

    const reopened = createCursorDraft(
      "devhub",
      "daily/review",
      textToBlocks("Changed in DevHub"),
      "/vault/notes",
      root,
    );
    expect(fs.readFileSync(reopened.markdownPath, "utf8")).toContain("Persistent Cursor note");

    expect(() =>
      applyCursorDraft(
        "devhub",
        "daily/review",
        textToBlocks("Changed in DevHub"),
        "/vault/notes",
        root,
      ),
    ).toThrowError(new CursorDraftError(
      "The DevHub note changed after Cursor opened it. Reopen the note before applying changes.",
      409,
    ));
  });

  it("deletes the persistent Markdown copy and manifest", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("devhub", "daily/review", source, "/vault/notes", root);

    expect(deleteCursorDraft("devhub", "daily/review", "/vault/notes", root)).toBe(true);
    expect(fs.existsSync(draft.markdownPath)).toBe(false);
    expect(deleteCursorDraft("devhub", "daily/review", "/vault/notes", root)).toBe(false);
  });

  it("marks rich BlockNote content as read-only", () => {
    const rich = [
      {
        id: "quote-1",
        type: "quote",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [{ type: "text", text: "Quoted", styles: {} }],
        children: [],
      },
    ];
    const draft = createCursorDraft("devhub", "daily/rich", rich, "/vault/notes", root);
    expect(draft.writable).toBe(false);
    expect(() =>
      applyCursorDraft("devhub", "daily/rich", rich, "/vault/notes", root),
    ).toThrow("cannot safely round-trip");
  });
});
