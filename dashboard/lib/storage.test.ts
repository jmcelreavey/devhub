import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NotesStorage } from "./storage";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhub-storage-"));
}

describe("NotesStorage", () => {
  let root: string;
  let storage: NotesStorage;

  beforeEach(() => {
    root = tmpdir();
    storage = new NotesStorage(root);
  });

  it("write/read round trip", () => {
    storage.write("daily/2026-05-08", [{ id: "1", type: "paragraph" }]);
    const result = storage.read("daily/2026-05-08");
    expect(result).not.toBeNull();
    expect(result!.content).toEqual([{ id: "1", type: "paragraph" }]);
  });

  it("renames a note when only the name casing changes", () => {
    storage.write("garden/sloped weeds purge", { x: 1 });
    const result = storage.rename("garden/sloped weeds purge", "garden/Sloped Weeds Purge");
    expect(result).not.toBeNull();
    expect(result!.content).toEqual({ x: 1 });
    expect(storage.read("garden/Sloped Weeds Purge")).not.toBeNull();
    expect(result!.path).toMatch(/sloped weeds purge\.json$/i);
  });

  it("delete returns false for missing files", () => {
    expect(storage.delete("nope")).toBe(false);
  });

  it("delete removes existing files", () => {
    storage.write("foo", { x: 1 });
    expect(storage.delete("foo")).toBe(true);
    expect(storage.read("foo")).toBeNull();
  });

  it("deleteDir removes a nested folder and its notes", () => {
    storage.write("learnings/archive/old", [{ id: "1", type: "paragraph" }]);
    expect(storage.deleteDir("learnings/archive")).toBe(true);
    expect(storage.read("learnings/archive/old")).toBeNull();
    expect(fs.existsSync(path.join(root, "learnings", "archive"))).toBe(false);
  });

  it("deleteDir returns false for a file path", () => {
    storage.write("solo", { x: 1 });
    expect(storage.deleteDir("solo")).toBe(false);
    expect(storage.read("solo")).not.toBeNull();
  });

  it("deleteDir returns false for missing path", () => {
    expect(storage.deleteDir("nope/nested")).toBe(false);
  });

  it("deleteDir returns false for empty path", () => {
    expect(storage.deleteDir("")).toBe(false);
    expect(storage.deleteDir("   ")).toBe(false);
  });

  it("deleteDir throws on path traversal", () => {
    expect(() => storage.deleteDir("../escape")).toThrow(/Path traversal/);
  });

  it("blocks path traversal via ..", () => {
    expect(() => storage.write("../escape", { x: 1 })).toThrow(/Path traversal/);
  });

  it("blocks absolute path traversal", () => {
    expect(() => storage.write("/etc/passwd", { x: 1 })).toThrow(/Path traversal/);
  });

  it("list returns sorted tree entries", () => {
    storage.write("z-last", {});
    storage.write("a-first", {});
    fs.mkdirSync(path.join(root, "subdir"), { recursive: true });
    storage.write("subdir/inner", {});
    const tree = storage.list();
    expect(tree.map((e) => e.name)).toEqual(["subdir", "a-first.json", "z-last.json"]);
  });

  it("list includes json files inside nested directories (does not treat dir name as .json file)", () => {
    storage.write("daily/2026-05-11", [
      { id: "1", type: "paragraph", content: [{ type: "text", text: "Hi", styles: {} }] },
    ]);
    const tree = storage.list();
    const daily = tree.find((e) => e.type === "dir" && e.name === "daily");
    expect(daily).toBeDefined();
    expect(daily!.children?.map((c) => c.name)).toContain("2026-05-11.json");
  });

  it("search includes learnings (full vault, not MCP workspace scope)", () => {
    storage.write("learnings/topic", [
      { id: "1", type: "paragraph", content: [{ type: "text", text: "vault learning hit" }] },
    ]);
    const results = storage.search("vault learning");
    expect(results.map((r) => r.path)).toContain("learnings/topic.json");
  });

  it("search finds matching text in note blocks", () => {
    storage.write("note", [
      {
        id: "1",
        type: "paragraph",
        content: [{ type: "text", text: "hello world" }],
      },
    ]);
    const results = storage.search("hello");
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("note.json");
  });

  it("search skips malformed JSON without throwing", () => {
    fs.writeFileSync(path.join(root, "bad.json"), "{not json");
    storage.write("good", [
      {
        id: "1",
        type: "paragraph",
        content: [{ type: "text", text: "ok" }],
      },
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = storage.search("ok");
    expect(results).toHaveLength(1);
    error.mockRestore();
  });

  it("search finds text in tldraw diagram shapes", () => {
    fs.mkdirSync(path.join(root, "diagrams"), { recursive: true });
    storage.write("diagrams/architecture", {
      type: "tldraw",
      version: 1,
      store: {
        store: {
          "shape:text1": { typeName: "shape", type: "text", props: { text: "API Gateway" } },
          "shape:box1": { typeName: "shape", type: "geo", props: { name: "Database" } },
        },
        schema: { schemaVersion: 2 },
      },
    });
    const results = storage.search("gateway");
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("diagrams/architecture.json");
    expect(results[0].text).toBe("API Gateway");
  });

  it("search finds text by shape name in tldraw diagrams", () => {
    fs.mkdirSync(path.join(root, "diagrams"), { recursive: true });
    storage.write("diagrams/flow", {
      type: "tldraw",
      version: 1,
      store: {
        store: {
          "shape:box1": { typeName: "shape", type: "geo", props: { name: "Auth Service" } },
        },
        schema: { schemaVersion: 2 },
      },
    });
    const results = storage.search("auth");
    expect(results).toHaveLength(1);
  });

  it("search returns mixed notes and diagram results", () => {
    fs.mkdirSync(path.join(root, "diagrams"), { recursive: true });
    storage.write("note-a", [
      { id: "1", type: "paragraph", content: [{ type: "text", text: "deploy pipeline", styles: {} }] },
    ]);
    storage.write("diagrams/pipeline", {
      type: "tldraw",
      version: 1,
      store: {
        store: {
          "shape:text1": { typeName: "shape", type: "text", props: { text: "deploy step" } },
        },
        schema: { schemaVersion: 2 },
      },
    });
    const results = storage.search("deploy");
    expect(results).toHaveLength(2);
  });

  it("list includes diagrams directory with nested files", () => {
    fs.mkdirSync(path.join(root, "diagrams"), { recursive: true });
    storage.write("diagrams/my-diagram", {
      type: "tldraw",
      version: 1,
      store: {},
    });
    const tree = storage.list();
    const diagramsDir = tree.find((e) => e.type === "dir" && e.name === "diagrams");
    expect(diagramsDir).toBeDefined();
    expect(diagramsDir!.children?.map((c) => c.name)).toContain("my-diagram.json");
  });
});
