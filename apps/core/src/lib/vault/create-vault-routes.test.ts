import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVaultRoutes } from "./create-vault-routes";

const stored = [
  { id: "h", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Task", styles: {} }], children: [] },
  { id: "s", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Summary", styles: {} }], children: [] },
  { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "From the agent.", styles: {} }], children: [] },
  { id: "n", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Notes", styles: {} }], children: [] },
  { id: "f", type: "paragraph", props: {}, content: [{ type: "text", text: "old free-form", styles: {} }], children: [] },
];
const mine = [
  { id: "h", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Task", styles: {} }], children: [] },
  { id: "n", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Notes", styles: {} }], children: [] },
  { id: "f2", type: "paragraph", props: {}, content: [{ type: "text", text: "my free-form", styles: {} }], children: [] },
];

const notes = createVaultRoutes("notes");
const docs = createVaultRoutes("docs");
let root: string;
let previousNotes: string | undefined;
let previousDocs: string | undefined;

function call(routes: typeof notes, method: "GET" | "PUT" | "POST" | "DELETE", parts: string[], body?: object, query = "") {
  return routes[method](new Request(`http://test/api/notes/${parts.join("/")}${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ path: parts }) });
}

function setNote(parts: string[], content: unknown, time: number) {
  const file = path.join(root, "notes", ...parts) + ".json";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content));
  fs.utimesSync(file, time, time);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-vault-route-"));
  previousNotes = process.env.NOTES_DIR;
  previousDocs = process.env.DOCS_DIR;
  process.env.NOTES_DIR = path.join(root, "notes");
  process.env.DOCS_DIR = path.join(root, "docs");
});

afterEach(() => {
  if (previousNotes === undefined) delete process.env.NOTES_DIR;
  else process.env.NOTES_DIR = previousNotes;
  if (previousDocs === undefined) delete process.env.DOCS_DIR;
  else process.env.DOCS_DIR = previousDocs;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("conditional vault writes", () => {
  it("requires a precondition before replacing existing content", async () => {
    setNote(["daily", "test"], stored, 100);
    expect((await call(notes, "PUT", ["daily", "test"], { content: mine })).status).toBe(428);
    expect((await (await call(notes, "GET", ["daily", "test"])).json()).content).toEqual(stored);
  });

  it("rejects stale autosaves and deletes without changing the newer note", async () => {
    setNote(["daily", "test"], stored, 100);
    const original = await (await call(notes, "GET", ["daily", "test"])).json();
    setNote(["daily", "test"], mine, 200);

    const save = await call(notes, "PUT", ["daily", "test"], { content: [], expectedModified: original.modified });
    expect(save.status).toBe(409);
    const remove = await call(notes, "DELETE", ["daily", "test"], undefined, `?expectedModified=${original.modified}`);
    expect(remove.status).toBe(409);
    expect((await (await call(notes, "GET", ["daily", "test"])).json()).content).toEqual(mine);
  });

  it("writes when the editor's version is current", async () => {
    setNote(["daily", "test"], stored, 100);
    const original = await (await call(notes, "GET", ["daily", "test"])).json();
    const response = await call(notes, "PUT", ["daily", "test"], { content: mine, expectedModified: original.modified });
    expect(response.status).toBe(200);
    expect((await (await call(notes, "GET", ["daily", "test"])).json()).content).toEqual(mine);
  });

  it("merges a task note's free-form blocks with newer agent sections", async () => {
    setNote(["task-notes", "t"], mine, 100);
    const original = await (await call(notes, "GET", ["task-notes", "t"])).json();
    setNote(["task-notes", "t"], stored, 200);
    const response = await call(notes, "PUT", ["task-notes", "t"], {
      content: mine, expectedModified: original.modified, mergeAgentSections: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body.content)).toContain("From the agent.");
    expect(JSON.stringify(body.content)).toContain("my free-form");
    expect(JSON.stringify(body.content)).not.toContain("old free-form");
    expect(body.merged).toEqual(body.content);
  });

  it("rejects a stale task note without merge and a stale non-task note with merge", async () => {
    for (const parts of [["task-notes", "t"], ["daily", "t"]]) {
      setNote(parts, mine, 100);
      const original = await (await call(notes, "GET", parts)).json();
      setNote(parts, stored, 200);
      const response = await call(notes, "PUT", parts, {
        content: mine, expectedModified: original.modified, mergeAgentSections: parts[0] !== "task-notes",
      });
      expect(response.status).toBe(409);
      expect((await (await call(notes, "GET", parts)).json()).content).toEqual(stored);
    }
  });

  it("does not merge when the task note version is current", async () => {
    setNote(["task-notes", "t"], stored, 100);
    const original = await (await call(notes, "GET", ["task-notes", "t"])).json();
    const response = await call(notes, "PUT", ["task-notes", "t"], {
      content: mine, expectedModified: original.modified, mergeAgentSections: true,
    });
    const body = await response.json();
    expect(body.content).toEqual(mine);
    expect(body.merged).toBeUndefined();
  });

  it("rejects a stale doc revision without losing the later edit", async () => {
    expect((await call(docs, "POST", ["guide"], { content: "original" })).status).toBe(201);
    const original = await (await call(docs, "GET", ["guide"])).json();
    expect((await call(docs, "PUT", ["guide"], { content: "later", expectedRevision: original.revision })).status).toBe(200);
    expect((await call(docs, "PUT", ["guide"], { content: "stale", expectedRevision: original.revision })).status).toBe(409);
    expect((await (await call(docs, "GET", ["guide"])).json()).content).toBe("later");
  });
});
