import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWorkspaceNoteRel, searchNotes } from "./index.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhub-notes-search-"));
}

function writeBlockNote(root: string, relPath: string, text: string): void {
  const full = path.join(root, relPath.endsWith(".json") ? relPath : `${relPath}.json`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    JSON.stringify([
      {
        id: "1",
        type: "paragraph",
        content: [{ type: "text", text, styles: {} }],
        children: [],
      },
    ]),
    "utf-8",
  );
}

describe("isWorkspaceNoteRel", () => {
  it("includes daily paths and root scratch", () => {
    expect(isWorkspaceNoteRel("daily/2026-05-13")).toBe(true);
    expect(isWorkspaceNoteRel("scratch.json")).toBe(true);
  });

  it("excludes learnings, sessions, diagrams", () => {
    expect(isWorkspaceNoteRel("learnings/tools")).toBe(false);
    expect(isWorkspaceNoteRel("sessions/abc")).toBe(false);
    expect(isWorkspaceNoteRel("diagrams/foo")).toBe(false);
  });
});

describe("searchNotes", () => {
  it("MCP scope: workspace only", () => {
    const tmp = makeTmp();
    writeBlockNote(tmp, "daily/2026-01-01", "findme daily");
    writeBlockNote(tmp, "scratch", "findme scratch");
    writeBlockNote(tmp, "learnings/deep", "findme hidden");
    const results = searchNotes(tmp, "findme", { includePath: isWorkspaceNoteRel, includeTldraw: false });
    const paths = results.map((r) => r.path);
    expect(paths).toContain("daily/2026-01-01.json");
    expect(paths).toContain("scratch.json");
    expect(paths).not.toContain("learnings/deep.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("dashboard scope: full vault including learnings", () => {
    const tmp = makeTmp();
    writeBlockNote(tmp, "learnings/topic", "findme learning");
    const results = searchNotes(tmp, "findme");
    expect(results.map((r) => r.path)).toContain("learnings/topic.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("indexes collection block ids", () => {
    const tmp = makeTmp();
    const full = path.join(tmp, "garden.json");
    fs.writeFileSync(
      full,
      JSON.stringify([
        {
          id: "1",
          type: "collection",
          props: { collectionId: "collection-123" },
          children: [],
        },
      ]),
      "utf-8",
    );
    const results = searchNotes(tmp, "collection-123");
    expect(results.map((r) => r.path)).toContain("garden.json");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes tldraw when enabled", () => {
    const tmp = makeTmp();
    fs.mkdirSync(path.join(tmp, "diagrams"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "diagrams/flow.json"),
      JSON.stringify({
        type: "tldraw",
        version: 1,
        store: {
          store: {
            "shape:text1": { typeName: "shape", type: "text", props: { text: "API Gateway" } },
          },
          schema: { schemaVersion: 2 },
        },
      }),
      "utf-8",
    );
    const results = searchNotes(tmp, "gateway", { includeTldraw: true });
    expect(results).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds text in tldraw v5 richText labels", () => {
    const tmp = makeTmp();
    fs.mkdirSync(path.join(tmp, "diagrams"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "diagrams/waterfall.json"),
      JSON.stringify({
        type: "tldraw",
        version: 1,
        store: {
          store: {
            "shape:wf0": {
              typeName: "shape",
              type: "geo",
              props: {
                richText: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Requirements" }] }],
                },
              },
            },
          },
          schema: { schemaVersion: 2 },
        },
      }),
      "utf-8",
    );
    expect(searchNotes(tmp, "requirements", { includeTldraw: true })).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("skips tldraw when disabled", () => {
    const tmp = makeTmp();
    fs.mkdirSync(path.join(tmp, "diagrams"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "diagrams/flow.json"),
      JSON.stringify({
        type: "tldraw",
        version: 1,
        store: {
          store: {
            "shape:text1": { typeName: "shape", type: "text", props: { text: "secret diagram" } },
          },
          schema: { schemaVersion: 2 },
        },
      }),
      "utf-8",
    );
    expect(searchNotes(tmp, "secret", { includeTldraw: false })).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
