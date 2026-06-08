import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWorkspaceNoteRel } from "../../shared/notes-search/scope.ts";
import { NotesStorage } from "../../mcp-servers/notes-server/src/storage";

function makeTmp(prefix = "notes-storage"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `devhub-${prefix}-`));
}

function makeBlock(text: string, type = "paragraph"): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    type,
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

describe("NotesStorage CRUD", () => {
  it("writes and reads a note", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("test-note", [makeBlock("hello")]);
    const r = s.read("test-note");
    expect(r).not.toBeNull();
    expect(r!.path).toBe("test-note.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("adds .json extension on read and write", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("my-note", [makeBlock("x")]);
    const r = s.read("my-note.json");
    expect(r).not.toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null for nonexistent note", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    expect(s.read("nope")).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates parent directories on write", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("daily/2026-01-01", [makeBlock("entry")]);
    const r = s.read("daily/2026-01-01");
    expect(r).not.toBeNull();
    expect(r!.path).toBe("daily/2026-01-01.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("overwrites existing note", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("note", [makeBlock("v1")]);
    s.write("note", [makeBlock("v2")]);
    const r = s.read("note");
    const blocks = r!.content as Record<string, unknown>[];
    const first = blocks[0] as Record<string, unknown>;
    const content = first.content as Record<string, unknown>[];
    expect((content[0] as { text: string }).text).toBe("v2");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes a note", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("doomed", [makeBlock("x")]);
    expect(s.delete("doomed")).toBe(true);
    expect(s.read("doomed")).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns false when deleting nonexistent note", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    expect(s.delete("ghost")).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads image assets under the notes root", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    const rel = "garden/project/assets/photo-1.jpg";
    const bytes = Buffer.from("fake-jpeg");
    const written = s.writeAsset(rel, bytes);
    expect(written.path).toBe(rel);
    expect(s.readAsset(rel)?.equals(bytes)).toBe(true);
    expect(() => s.writeAsset("daily/note.json", bytes)).toThrow(/\.json/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("NotesStorage list", () => {
  it("lists directories and json files", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("daily/2026-01-01", [makeBlock("a")]);
    s.write("scratch", [makeBlock("b")]);
    const entries = s.list();
    const names = entries.map((e) => e.name);
    expect(names).toContain("daily");
    expect(names).toContain("scratch.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty array for nonexistent root", () => {
    const s = new NotesStorage("/no/such/dir");
    expect(s.list()).toEqual([]);
  });

  it("excludes dotfiles and node_modules", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("visible", [makeBlock("x")]);
    fs.writeFileSync(path.join(tmp, ".hidden.json"), "[]");
    fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
    const entries = s.list();
    expect(entries.every((e) => e.name !== "node_modules")).toBe(true);
    expect(entries.every((e) => e.name !== ".hidden.json")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

/** MCP `notes_search` contract — workspace scope via shared searchNotes (not dashboard /api/search). */
describe("NotesStorage search (MCP workspace scope)", () => {
  it("finds text in workspace notes (daily + root json)", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("daily/2026-01-01", [makeBlock("findme daily")]);
    s.write("scratch", [makeBlock("findme scratch")]);
    s.write("learnings/deep", [makeBlock("findme hidden")]);
    const results = s.search("findme");
    const paths = results.map((r) => r.path);
    expect(paths).toContain("daily/2026-01-01.json");
    expect(paths).toContain("scratch.json");
    expect(paths).not.toContain("learnings/deep.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty array when nothing matches", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("note", [makeBlock("nothing here")]);
    expect(s.search("missing")).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("handles malformed JSON gracefully", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    fs.writeFileSync(path.join(tmp, "bad.json"), "not json");
    s.write("good", [makeBlock("findme")]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = s.search("findme");
    expect(results.length).toBe(1);
    error.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("NotesStorage path security", () => {
  it("blocks path traversal with ..", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    expect(() => s.read("../../../etc/passwd")).toThrow("Path traversal");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("blocks symlink escape on read", () => {
    const tmp = makeTmp();
    const outside = makeTmp("outside");
    fs.writeFileSync(path.join(outside, "escape.json"), "[]");
    fs.symlinkSync(outside, path.join(tmp, "link"));
    const s = new NotesStorage(tmp);
    expect(() => s.read("link/escape")).toThrow("Path traversal");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("isWorkspaceNoteRel", () => {
  it("includes daily paths", () => {
    expect(isWorkspaceNoteRel("daily/2026-05-13")).toBe(true);
  });

  it("includes root json files", () => {
    expect(isWorkspaceNoteRel("scratch")).toBe(true);
  });

  it("excludes learnings", () => {
    expect(isWorkspaceNoteRel("learnings/tools")).toBe(false);
  });

  it("excludes sessions", () => {
    expect(isWorkspaceNoteRel("sessions/abc")).toBe(false);
  });

  it("excludes diagrams", () => {
    expect(isWorkspaceNoteRel("diagrams/foo")).toBe(false);
  });
});

describe("NotesStorage atomic write", () => {
  it("does not leave temp files on success", () => {
    const tmp = makeTmp();
    const s = new NotesStorage(tmp);
    s.write("note", [makeBlock("x")]);
    const tmps = fs.readdirSync(tmp).filter((f) => f.endsWith(".tmp"));
    expect(tmps).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
