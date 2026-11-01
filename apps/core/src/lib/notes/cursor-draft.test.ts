import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blocksToText, textToBlocks } from "../../../../../packages/shared/ui-lib/markdown-convert";
import {
  applyCursorDraft,
  createCursorDraft,
  CursorDraftError,
  deleteCursorDraft,
  getCursorDraft,
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

  it("uses a predictable path and finds a persisted working copy", () => {
    const draft = createCursorDraft(
      "example-app",
      "discovery/ABC-4485",
      textToBlocks("Original"),
      "/vault/notes",
      root,
    );

    expect(draft.markdownPath).toMatch(/example-app\/discovery\/ABC-4485-[a-f0-9]{16}\.md$/);
    expect(getCursorDraft("example-app", "discovery/ABC-4485", "/vault/notes", root)).toEqual({ writable: true });
  });

  it("separates sanitised path collisions and the same note in different vaults", () => {
    const firstSource = textToBlocks("First");
    const secondSource = textToBlocks("Second");
    const thirdSource = textToBlocks("Third");
    const first = createCursorDraft("devhub", "daily/a b", firstSource, "/vault/one", root);
    const second = createCursorDraft("devhub", "daily/a-b", secondSource, "/vault/one", root);
    const third = createCursorDraft("devhub", "daily/a b", thirdSource, "/vault/two", root);

    expect(new Set([first.markdownPath, second.markdownPath, third.markdownPath]).size).toBe(3);
    expect(blocksToText(applyCursorDraft("devhub", "daily/a b", firstSource, "/vault/one", root))).toBe("First");
    expect(blocksToText(applyCursorDraft("devhub", "daily/a-b", secondSource, "/vault/one", root))).toBe("Second");
    expect(blocksToText(applyCursorDraft("devhub", "daily/a b", thirdSource, "/vault/two", root))).toBe("Third");
  });

  it("reuses matching old drafts but never reuses or overwrites a different identity", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("devhub", "daily/a b", source, "/vault/one", root);
    const oldMarkdown = path.join(root, "devhub", "daily", "a-b.md");
    const oldManifest = oldMarkdown.replace(/\.md$/, ".json");
    fs.renameSync(draft.markdownPath, oldMarkdown);
    fs.renameSync(draft.markdownPath.replace(/\.md$/, ".json"), oldManifest);
    fs.appendFileSync(oldMarkdown, "\nUnapplied edit");

    expect(createCursorDraft("devhub", "daily/a b", source, "/vault/one", root).markdownPath).toBe(oldMarkdown);
    const other = createCursorDraft("devhub", "daily/a-b", source, "/vault/one", root);
    expect(other.markdownPath).not.toBe(oldMarkdown);
    expect(fs.readFileSync(oldMarkdown, "utf8")).toContain("Unapplied edit");
    expect(getCursorDraft("devhub", "daily/a b", "/vault/two", root)).toBeNull();
    expect(deleteCursorDraft("devhub", "daily/a b", "/vault/two", root)).toBe(false);
    expect(createCursorDraft("devhub", "daily/a b", source, "/vault/two", root).markdownPath).not.toBe(oldMarkdown);
    expect(fs.readFileSync(oldMarkdown, "utf8")).toContain("Unapplied edit");
  });

  it("keeps an occupied hashed path intact when its manifest has another identity", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("devhub", "daily/review", source, "/vault/one", root);
    const manifestPath = draft.markdownPath.replace(/\.md$/, ".json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.notePath = "daily/other";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.appendFileSync(draft.markdownPath, "\nSomeone else’s edit");

    const fresh = createCursorDraft("devhub", "daily/review", source, "/vault/one", root);
    expect(fresh.markdownPath).not.toBe(draft.markdownPath);
    expect(fs.readFileSync(draft.markdownPath, "utf8")).toContain("Someone else’s edit");
    fs.unlinkSync(draft.markdownPath);
    fs.unlinkSync(manifestPath);
    expect(createCursorDraft("devhub", "daily/review", source, "/vault/one", root).markdownPath).toBe(fresh.markdownPath);
  });

  it("does not overwrite an orphaned working copy", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("devhub", "daily/review", source, "/vault/one", root);
    fs.unlinkSync(draft.markdownPath.replace(/\.md$/, ".json"));
    fs.appendFileSync(draft.markdownPath, "\nUnapplied edit");

    const fresh = createCursorDraft("devhub", "daily/review", source, "/vault/one", root);
    expect(fresh.markdownPath).not.toBe(draft.markdownPath);
    expect(fs.readFileSync(draft.markdownPath, "utf8")).toContain("Unapplied edit");
  });

  it("finds working copies created before predictable paths", () => {
    const notePath = "discovery/ABC-4485";
    const vaultRoot = "/vault/notes";
    const draft = createCursorDraft("example-app", notePath, textToBlocks("Original"), vaultRoot, root);
    const vaultKey = crypto.createHash("sha256").update(path.resolve(vaultRoot)).digest("hex").slice(0, 12);
    const key = crypto
      .createHash("sha256")
      .update(`${vaultKey}\0example-app\0${notePath}`)
      .digest("hex")
      .slice(0, 16);

    fs.renameSync(draft.markdownPath, path.join(root, `ABC-4485-${key}.md`));
    fs.renameSync(draft.markdownPath.replace(/\.md$/, ".json"), path.join(root, `${key}.json`));

    expect(getCursorDraft("example-app", notePath, vaultRoot, root)).toEqual({ writable: true });
  });

  it("keeps headerless Cursor edits available and restores their header on reopen", () => {
    const source = textToBlocks("Original");
    const draft = createCursorDraft("example-app", "discovery/ABC-4485", source, "/vault/notes", root);
    const editedMarkdown = fs.readFileSync(draft.markdownPath, "utf8")
      .replace(/<!--[\s\S]*?-->\n+/, "")
      .replace("Original", "Updated from Cursor");
    fs.writeFileSync(draft.markdownPath, editedMarkdown);

    expect(getCursorDraft("example-app", "discovery/ABC-4485", "/vault/notes", root)).toEqual({ writable: true });
    expect(blocksToText(applyCursorDraft("example-app", "discovery/ABC-4485", source, "/vault/notes", root)))
      .toContain("Updated from Cursor");

    createCursorDraft("example-app", "discovery/ABC-4485", source, "/vault/notes", root);
    expect(fs.readFileSync(draft.markdownPath, "utf8")).toMatch(/^<!-- DEVHUB NOTE WORKING COPY/);
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
