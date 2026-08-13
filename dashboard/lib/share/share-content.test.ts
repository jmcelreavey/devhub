import { describe, it, expect } from "vitest";
import { createEmptyDiagram, type TldrawDiagramData } from "@/lib/diagram-utils";
import { tldrawToShareMarkdown } from "@/lib/share/share-content";

function diagramWithShape(label = "Auth service"): TldrawDiagramData {
  return {
    type: "tldraw",
    version: 1,
    store: {
      store: {
        "shape:abc": {
          id: "shape:abc",
          type: "geo",
          props: { text: label },
        },
      },
    },
  };
}

describe("tldrawToShareMarkdown", () => {
  it("returns empty string for an empty canvas", () => {
    expect(tldrawToShareMarkdown("Blank", createEmptyDiagram())).toBe("");
  });

  it("wraps the diagram JSON in a markdown snapshot", () => {
    const content = diagramWithShape("Gateway");
    const md = tldrawToShareMarkdown("Legal architecture overview", content);
    expect(md).toContain("# Legal architecture overview");
    expect(md).toContain("DevHub tldraw diagram snapshot.");
    expect(md).toContain("```json");
    expect(md).toContain('"type": "tldraw"');
    expect(md).toContain("Gateway");
    expect(md.trimEnd().endsWith("```")).toBe(true);
  });

  it("is stable for content-hash drift detection", () => {
    const content = diagramWithShape();
    const a = tldrawToShareMarkdown("Flow", content);
    const b = tldrawToShareMarkdown("Flow", content);
    expect(a).toBe(b);
  });
});
