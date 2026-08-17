import { describe, expect, it, beforeEach } from "vitest";
import {
  clearDiagramPreviewCache,
  invalidateDiagramPreview,
  peekDiagramPreview,
  previewFromDiagramContent,
  rememberDiagramPreview,
} from "./thumbnail-cache";

describe("thumbnail-cache", () => {
  beforeEach(() => clearDiagramPreviewCache());

  it("returns a remembered preview and misses on mtime change", () => {
    rememberDiagramPreview("diagrams/foo", { empty: true }, 10);
    expect(peekDiagramPreview("diagrams/foo", 10)).toEqual({ empty: true });
    expect(peekDiagramPreview("diagrams/foo", 11)).toBeUndefined();
  });

  it("invalidate drops the entry", () => {
    rememberDiagramPreview("diagrams/foo", { empty: false, store: {} }, 1);
    invalidateDiagramPreview("diagrams/foo");
    expect(peekDiagramPreview("diagrams/foo", 1)).toBeUndefined();
  });
});

describe("previewFromDiagramContent", () => {
  it("marks missing or empty stores as empty", () => {
    expect(previewFromDiagramContent(null)).toEqual({ empty: true });
    expect(previewFromDiagramContent({})).toEqual({ empty: true });
    expect(previewFromDiagramContent({ store: {} })).toEqual({ empty: true });
    expect(previewFromDiagramContent({ store: { "page:page": { id: "page:page" } } })).toEqual({
      empty: true,
    });
  });

  it("keeps the tldraw store when shapes exist", () => {
    const store = { "shape:text1": { typeName: "shape", type: "text" } };
    expect(previewFromDiagramContent({ type: "tldraw", version: 1, store })).toEqual({
      empty: false,
      store,
    });
  });
});
