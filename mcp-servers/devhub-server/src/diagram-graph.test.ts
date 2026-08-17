import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createTLSchema } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import { buildGraphRecords, layoutGraph, type GraphSpec } from "./diagram-graph.ts";

describe("source encoding", () => {
  it("does not contain raw NUL bytes", () => {
    const buf = fs.readFileSync(fileURLToPath(new URL("./diagram-graph.ts", import.meta.url)));
    expect(buf.includes(0)).toBe(false);
  });
});

const spec: GraphSpec = {
  title: "Job Search Agent",
  nodes: [
    { id: "browser", label: "Member browser", group: "acme-app" },
    { id: "bff", label: "Acme BFF\n/ajax/job-search-agent", group: "acme-app" },
    { id: "api", label: "Job Search Agent API\nNestJS on EKS", group: "backend" },
    { id: "s3", label: "S3 CV bucket", group: "backend" },
    { id: "parser", label: "CV parser\nSQS consumer", group: "backend" },
    { id: "mongo", label: "MongoDB\nfantasyStocks" },
  ],
  edges: [
    { from: "browser", to: "bff" },
    { from: "bff", to: "api" },
    { from: "browser", to: "s3", label: "presigned PUT" },
    { from: "s3", to: "parser", label: "ObjectCreated" },
    { from: "api", to: "mongo" },
    { from: "parser", to: "mongo" },
  ],
  groups: [
    { id: "acme-app", label: "Acme" },
    { id: "backend", label: "fantasy-stocks" },
  ],
};

const boxes = (records: Record<string, unknown>) =>
  Object.values(records)
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => r.typeName === "shape" && (r.type === "geo" || r.type === "note"))
    .map((r) => {
      const props = r.props as Record<string, number>;
      return { x: r.x as number, y: r.y as number, w: props.w, h: props.h };
    });

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("layoutGraph", () => {
  it("puts sources in the first layer and sinks in the last", () => {
    const { nodes } = layoutGraph(spec);
    const layer = (id: string) => nodes.find((n) => n.id === id)?.layer;
    expect(layer("browser")).toBe(0);
    expect(layer("mongo")).toBeGreaterThan(layer("api") ?? 0);
  });

  it("never overlaps two nodes", () => {
    const { nodes } = layoutGraph(spec);
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        expect(overlaps(nodes[i], nodes[j])).toBe(false);
      }
    }
  });

  it("survives a cycle instead of recursing forever", () => {
    const cyclic: GraphSpec = {
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    };
    expect(() => layoutGraph(cyclic)).not.toThrow();
    expect(layoutGraph(cyclic).nodes).toHaveLength(3);
  });

  it("sizes nodes to their text", () => {
    const { nodes } = layoutGraph(spec);
    const short = nodes.find((n) => n.id === "s3");
    const long = nodes.find((n) => n.id === "bff");
    expect(long?.h).toBeGreaterThanOrEqual(short?.h ?? 0);
  });

  it("lays out downwards when asked", () => {
    const down = layoutGraph({ ...spec, direction: "down" });
    const browser = down.nodes.find((n) => n.id === "browser");
    const mongo = down.nodes.find((n) => n.id === "mongo");
    expect(mongo?.y ?? 0).toBeGreaterThan(browser?.y ?? 0);
  });
});

describe("buildGraphRecords", () => {
  it("emits a shape per node, an arrow per edge, and two bindings per arrow", () => {
    const records = buildGraphRecords(spec);
    const values = Object.values(records) as Array<Record<string, unknown>>;
    const arrows = values.filter((r) => r.type === "arrow" && r.typeName === "shape");
    const bindings = values.filter((r) => r.typeName === "binding");
    const geos = values.filter((r) => r.type === "geo");

    expect(arrows).toHaveLength(spec.edges?.length ?? 0);
    expect(bindings).toHaveLength((spec.edges?.length ?? 0) * 2);
    // 6 nodes + 2 group backgrounds
    expect(geos).toHaveLength(8);
    expect(values.filter((r) => r.type === "text")).toHaveLength(1);
  });

  it("binds every arrow to two shapes that exist", () => {
    const records = buildGraphRecords(spec);
    const values = Object.values(records) as Array<Record<string, unknown>>;
    for (const binding of values.filter((r) => r.typeName === "binding")) {
      expect(records[binding.fromId as string]).toBeDefined();
      expect(records[binding.toId as string]).toBeDefined();
    }
  });

  it("does not overlap node boxes", () => {
    const nodeBoxes = boxes(buildGraphRecords({ ...spec, groups: undefined })).filter(
      // group backgrounds are meant to sit behind their members
      (box) => box.w === 260,
    );
    for (let i = 0; i < nodeBoxes.length; i += 1) {
      for (let j = i + 1; j < nodeBoxes.length; j += 1) {
        expect(overlaps(nodeBoxes[i], nodeBoxes[j])).toBe(false);
      }
    }
  });

  it("keeps every node inside its own lane band", () => {
    const records = buildGraphRecords(spec);
    const { nodes } = layoutGraph(spec);
    const bands = boxes(records).filter((box) => box.w > 260);

    expect(bands).toHaveLength(2);
    // Ungrouped nodes sit in an unlabelled lane, which deliberately has no band.
    for (const node of nodes.filter((n) => n.group)) {
      const owning = bands.filter(
        (band) => node.y >= band.y && node.y + node.h <= band.y + band.h,
      );
      // Exactly one band contains each grouped node — never two.
      expect(owning).toHaveLength(1);
    }
  });

  it("never overlaps two lane bands", () => {
    const bands = boxes(buildGraphRecords(spec)).filter((box) => box.w > 260);
    for (let i = 0; i < bands.length; i += 1) {
      for (let j = i + 1; j < bands.length; j += 1) {
        expect(overlaps(bands[i], bands[j])).toBe(false);
      }
    }
  });

  it("produces records the real tldraw schema accepts", () => {
    const schema = createTLSchema();
    const records = buildGraphRecords(spec);
    for (const record of Object.values(records) as Array<Record<string, unknown>>) {
      const validator = record.typeName === "binding" ? schema.types.binding : schema.types.shape;
      expect(() => validator.validate(record)).not.toThrow();
    }
  });

  it("stays schema-valid past the first index bucket", () => {
    // 40 nodes + 39 edges is ~120 records; the old base-36 index counter emitted the
    // invalid key "a10" at record 36 and tldraw refused to open the file at all.
    const big: GraphSpec = {
      nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: Array.from({ length: 39 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
    };

    const schema = createTLSchema();
    const records = buildGraphRecords(big);
    expect(Object.keys(records).length).toBeGreaterThan(100);

    for (const record of Object.values(records) as Array<Record<string, unknown>>) {
      const validator = record.typeName === "binding" ? schema.types.binding : schema.types.shape;
      expect(() => validator.validate(record)).not.toThrow();
    }
  });

  it("ignores edges pointing at unknown nodes", () => {
    const records = buildGraphRecords({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    const values = Object.values(records) as Array<Record<string, unknown>>;
    expect(values.filter((r) => r.type === "arrow")).toHaveLength(0);
  });
});
