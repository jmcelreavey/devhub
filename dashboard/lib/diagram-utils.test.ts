import { describe, expect, it } from "vitest";
import {
  hasVisibleDiagramShapes,
  isDiagramStoragePath,
} from "./diagram-utils";

describe("hasVisibleDiagramShapes", () => {
  it("is false for empty store", () => {
    expect(hasVisibleDiagramShapes({})).toBe(false);
  });

  it("is false when store has no shape keys", () => {
    expect(hasVisibleDiagramShapes({ "page:page": { id: "page:page" } })).toBe(false);
  });

  it("is true when store has shape entries", () => {
    expect(hasVisibleDiagramShapes({
      "shape:text1": { typeName: "shape", type: "text" },
    })).toBe(true);
  });

  it("drills into a persisted TLStoreSnapshot ({ store, schema })", () => {
    expect(hasVisibleDiagramShapes({
      store: { "shape:text1": { typeName: "shape", type: "text" } },
      schema: { schemaVersion: 2 },
    })).toBe(true);
    expect(hasVisibleDiagramShapes({
      store: { "page:page": { id: "page:page" } },
      schema: { schemaVersion: 2 },
    })).toBe(false);
  });
});

describe("isDiagramStoragePath", () => {
  it("matches diagrams prefix", () => {
    expect(isDiagramStoragePath("diagrams/foo.json")).toBe(true);
    expect(isDiagramStoragePath("notes/foo.json")).toBe(false);
  });
});
