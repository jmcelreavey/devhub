import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTLSchema } from "@tldraw/tlschema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotesStorage } from "./storage.ts";
import { DiagramsStorage } from "./task-diagram-storage.ts";
import { diagramDelete, diagramRead, diagramSetGraph, diagramUpdate } from "../../../packages/shared/actions/diagrams.ts";

const LONG_NOTE = [
  "Browser PUT via presigned URL",
  "PDF or DOCX source",
  "CORS must allow page origin",
  "ObjectCreated notification",
  "CV deleted after parse",
].join("\n");

describe("DiagramsStorage", () => {
  let root: string;
  let diagrams: DiagramsStorage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-diagrams-"));
    diagrams = new DiagramsStorage(new NotesStorage(root));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const shapesOf = (diagramPath: string) => {
    const data = diagrams.read(diagramPath) as Record<string, Record<string, Record<string, never>>>;
    return Object.values(data.store.store).filter(
      (record: Record<string, unknown>) => record.typeName === "shape",
    ) as Array<Record<string, unknown>>;
  };

  it("shares diagram reads and updates across HTTP and MCP without bypassing stale-write protection", async () => {
    const { path: diagramPath } = await diagrams.create("shared-contract");
    const storage = new NotesStorage(root);
    const http = { mode: "http" as const, storage };
    const mcp = { mode: "mcp" as const, storage: diagrams };
    const writeContext = (expectedModified?: number) => ({
      mode: "http" as const,
      notes: { mode: "http" as const, storage, createOnly: false, expectedModified, merge: () => null },
    });
    const data = JSON.stringify({ type: "tldraw", version: 1, store: { store: {} } });
    const written = await diagramUpdate.handler({ path: diagramPath, data }, writeContext(storage.read(diagramPath)!.modified));
    expect(written.mode).toBe("http");
    const fromHttp = await diagramRead.handler({ path: diagramPath, raw: true }, http);
    const fromMcp = await diagramRead.handler({ path: diagramPath, raw: true }, mcp);
    expect(fromHttp.mode === "http" && fromHttp.file?.content).toEqual(fromMcp.mode === "mcp" && fromMcp.raw && fromMcp.data);
    const stale = await diagramUpdate.handler({ path: diagramPath, data }, writeContext(0));
    expect(stale.mode === "http" && stale.result.file).toBeNull();
    expect(await diagramUpdate.handler({ path: diagramPath, data: "{" }, mcp)).toEqual({ mode: "invalid" });
    expect(() => diagramRead.handler({ path: "diagrams/../../outside", raw: true }, http)).toThrow();
  });

  it("validates graph inputs and deletes the same diagram from either transport", async () => {
    const { path: diagramPath } = await diagrams.create("shared-graph");
    expect(diagramSetGraph.input.safeParse({ path: diagramPath, nodes: "bad" }).success).toBe(false);
    const graph = diagramSetGraph.input.parse({ path: diagramPath, nodes: [{ id: "one", label: "One" }] });
    const { path: graphPath, ...spec } = graph;
    const result = await diagrams.setGraph(graphPath, spec);
    expect(result?.shapes).toBe(1);
    expect(await diagramDelete.handler({ path: diagramPath }, new NotesStorage(root))).toEqual({ path: diagramPath, deleted: true });
    expect(await diagrams.delete(diagramPath)).toBe(false);
  });

  it("measures growY so a long note is taller than the base box", async () => {
    const { path: diagramPath } = await diagrams.create("sizing");
    const added = await diagrams.addNote(diagramPath, { text: LONG_NOTE });

    expect(added).not.toBeNull();
    expect(added?.h).toBeGreaterThan(200);

    const note = shapesOf(diagramPath)[0];
    const props = note.props as Record<string, number>;
    expect(props.growY).toBe((added?.h ?? 0) - 200);
  });

  it("stacks auto-placed notes without overlapping", async () => {
    const { path: diagramPath } = await diagrams.create("stacking");
    const placed = [];
    for (let i = 0; i < 6; i++) placed.push(await diagrams.addNote(diagramPath, { text: `${LONG_NOTE}\nnote ${i}` }));

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!a || !b) throw new Error("note was not placed");
        const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(hit).toBe(false);
      }
    }
  });

  it("starts a new column instead of one endless row", async () => {
    const { path: diagramPath } = await diagrams.create("columns");
    const placed = [];
    for (let i = 0; i < 8; i++) placed.push(await diagrams.addNote(diagramPath, { text: LONG_NOTE }));
    const columns = new Set(placed.map((note) => note?.x));
    expect(columns.size).toBeGreaterThan(1);
    expect(columns.size).toBeLessThan(placed.length);
  });

  it("honours explicit coordinates", async () => {
    const { path: diagramPath } = await diagrams.create("explicit");
    const added = await diagrams.addNote(diagramPath, { text: "pinned", x: 640, y: -120 });
    expect(added?.x).toBe(640);
    expect(added?.y).toBe(-120);
  });

  it("sizes a geo shape to its text", async () => {
    const { path: diagramPath } = await diagrams.create("geo");
    const short = await diagrams.addShape(diagramPath, { text: "API" });
    const long = await diagrams.addShape(diagramPath, { text: LONG_NOTE });
    expect(long?.h).toBeGreaterThan(short?.h ?? 0);
  });

  it("binds an arrow to both endpoints", async () => {
    const { path: diagramPath } = await diagrams.create("arrows");
    const from = await diagrams.addShape(diagramPath, { text: "Acme" });
    const to = await diagrams.addShape(diagramPath, { text: "fantasy-stocks" });
    const arrow = await diagrams.addArrow(diagramPath, {
      from: from?.shapeId ?? "",
      to: to?.shapeId ?? "",
      text: "proxy",
    });

    expect(arrow).not.toBeNull();
    const data = diagrams.read(diagramPath) as Record<string, Record<string, Record<string, never>>>;
    const bindings = Object.values(data.store.store).filter(
      (record: Record<string, unknown>) => record.typeName === "binding",
    ) as Array<Record<string, unknown>>;

    expect(bindings).toHaveLength(2);
    expect(bindings.every((binding) => binding.fromId === arrow?.shapeId)).toBe(true);
    expect(new Set(bindings.map((binding) => binding.toId))).toEqual(
      new Set([from?.shapeId, to?.shapeId]),
    );
  });

  it("refuses an arrow to a shape that does not exist", async () => {
    const { path: diagramPath } = await diagrams.create("bad-arrow");
    const from = await diagrams.addShape(diagramPath, { text: "A" });
    expect(await diagrams.addArrow(diagramPath, { from: from?.shapeId ?? "", to: "shape:ghost" })).toBeNull();
  });

  it("writes a schema-valid graph with no overlapping shapes", async () => {
    const { path: diagramPath } = await diagrams.create("graph");
    const result = await diagrams.setGraph(diagramPath, {
      title: "Upload",
      nodes: [
        { id: "browser", label: "Member browser" },
        { id: "bff", label: "Acme BFF" },
        { id: "api", label: "Job Search Agent API" },
      ],
      edges: [
        { from: "browser", to: "bff" },
        { from: "bff", to: "api" },
      ],
    });

    expect(result?.shapes).toBeGreaterThan(0);

    const schema = createTLSchema();
    const data = diagrams.read(diagramPath) as Record<string, Record<string, Record<string, never>>>;
    for (const record of Object.values(data.store.store) as Array<Record<string, unknown>>) {
      if (record.typeName !== "shape" && record.typeName !== "binding") continue;
      const validator = record.typeName === "binding" ? schema.types.binding : schema.types.shape;
      expect(() => validator.validate(record)).not.toThrow();
    }

    const summary = diagrams.summarize(diagramPath);
    expect(summary?.overlaps).toEqual([]);
  });

  it("summarises shapes and flags overlaps", async () => {
    const { path: diagramPath } = await diagrams.create("summary");
    await diagrams.addNote(diagramPath, { text: "one", x: 0, y: 0 });
    await diagrams.addNote(diagramPath, { text: "two", x: 50, y: 50 });

    const summary = diagrams.summarize(diagramPath);
    expect(summary?.shapes).toHaveLength(2);
    expect(summary?.shapes[0].text).toBe("one");
    expect(summary?.overlaps).toHaveLength(1);
  });

  it("repairs notes written with growY zero", async () => {
    const { path: diagramPath } = await diagrams.create("repair");
    await diagrams.addNote(diagramPath, { text: LONG_NOTE });

    // Simulate the old writer, which always wrote growY: 0.
    const data = diagrams.read(diagramPath) as Record<string, Record<string, Record<string, never>>>;
    for (const record of Object.values(data.store.store) as Array<Record<string, unknown>>) {
      if (record.type === "note") (record.props as Record<string, number>).growY = 0;
    }
    await diagrams.update(diagramPath, data);

    const repaired = await diagrams.repairAll();
    expect(repaired).toHaveLength(1);
    expect(repaired[0].repaired).toBe(1);

    const note = shapesOf(diagramPath)[0];
    expect((note.props as Record<string, number>).growY).toBeGreaterThan(0);
  });

  it("is idempotent once repaired", async () => {
    const { path: diagramPath } = await diagrams.create("idempotent");
    await diagrams.addNote(diagramPath, { text: LONG_NOTE });
    expect(await diagrams.repairAll()).toEqual([]);
  });
});
