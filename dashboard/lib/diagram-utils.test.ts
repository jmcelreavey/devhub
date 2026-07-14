import { describe, expect, it } from "vitest";
import {
  collectDiagramFolderRelPaths,
  createEmptyDiagram,
  diagramBreadcrumbs,
  diagramFolderChildren,
  diagramFolderHref,
  diagramFolderStoragePath,
  diagramParentFolder,
  extractDiagramsTree,
  hasVisibleDiagramShapes,
  isDiagramStoragePath,
  normalizeDiagramFolder,
  splitDiagramEntries,
  type DiagramTreeEntry,
} from "./diagram-utils";

const sampleTree: DiagramTreeEntry[] = [
  { type: "dir", name: "notes-stuff", path: "daily", children: [] },
  {
    type: "dir",
    name: "diagrams",
    path: "diagrams",
    children: [
      { type: "file", name: "top-level.json", path: "diagrams/top-level.json", modified: 3 },
      {
        type: "dir",
        name: "Acme",
        path: "diagrams/Acme",
        children: [
          {
            type: "dir",
            name: "Reports",
            path: "diagrams/Acme/Reports",
            children: [
              {
                type: "file",
                name: "Matching&Crawling.json",
                path: "diagrams/Acme/Reports/Matching&Crawling.json",
                modified: 1,
              },
            ],
          },
        ],
      },
    ],
  },
];

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

describe("createEmptyDiagram", () => {
  it("creates an empty diagram without forcing tldraw to load fake session state", () => {
    const diagram = createEmptyDiagram();
    expect(diagram.store).toEqual({});
  });
});

describe("isDiagramStoragePath", () => {
  it("matches diagrams prefix", () => {
    expect(isDiagramStoragePath("diagrams/foo.json")).toBe(true);
    expect(isDiagramStoragePath("notes/foo.json")).toBe(false);
  });
});

describe("normalizeDiagramFolder", () => {
  it("trims slashes and collapses doubles", () => {
    expect(normalizeDiagramFolder("/Acme//Reports/")).toBe("Acme/Reports");
    expect(normalizeDiagramFolder("")).toBe("");
    expect(normalizeDiagramFolder(null)).toBe("");
  });
});

describe("diagramFolderStoragePath", () => {
  it("returns the diagrams root for an empty folder", () => {
    expect(diagramFolderStoragePath("")).toBe("diagrams");
  });
  it("prefixes nested folders", () => {
    expect(diagramFolderStoragePath("Acme/Reports")).toBe("diagrams/Acme/Reports");
  });
});

describe("diagramFolderHref", () => {
  it("links to the index at the root", () => {
    expect(diagramFolderHref("")).toBe("/diagrams");
  });
  it("encodes the folder query param", () => {
    expect(diagramFolderHref("Acme/Reports App")).toBe("/diagrams?folder=Acme%2FReports%20App");
  });
});

describe("diagramParentFolder", () => {
  it("returns the parent rel path", () => {
    expect(diagramParentFolder("Acme/Reports")).toBe("Acme");
    expect(diagramParentFolder("Acme")).toBe("");
  });
});

describe("extractDiagramsTree", () => {
  it("returns the children of the diagrams dir", () => {
    const children = extractDiagramsTree(sampleTree);
    expect(children.map((c) => c.name)).toEqual(["top-level.json", "Acme"]);
  });
  it("returns [] when there is no diagrams dir", () => {
    expect(extractDiagramsTree([{ type: "dir", name: "daily", path: "daily" }])).toEqual([]);
  });
});

describe("diagramFolderChildren", () => {
  const diagramsTree = extractDiagramsTree(sampleTree);
  it("returns the root entries for an empty folder", () => {
    expect(diagramFolderChildren(diagramsTree, "")).toBe(diagramsTree);
  });
  it("navigates into nested folders", () => {
    const entries = diagramFolderChildren(diagramsTree, "Acme/Reports");
    expect(entries?.map((e) => e.name)).toEqual(["Matching&Crawling.json"]);
  });
  it("returns null for a missing folder", () => {
    expect(diagramFolderChildren(diagramsTree, "Nope")).toBeNull();
  });
});

describe("splitDiagramEntries", () => {
  it("separates folders and diagram files", () => {
    const diagramsTree = extractDiagramsTree(sampleTree);
    const { folders, files } = splitDiagramEntries(diagramsTree);
    expect(folders).toEqual([
      { relPath: "Acme", name: "Acme", storagePath: "diagrams/Acme" },
    ]);
    expect(files).toEqual([
      { path: "diagrams/top-level", name: "top-level", modified: 3 },
    ]);
  });
});

describe("diagramBreadcrumbs", () => {
  it("starts at Diagrams and builds cumulative paths", () => {
    expect(diagramBreadcrumbs("Acme/Reports")).toEqual([
      { name: "Diagrams", relPath: "" },
      { name: "Acme", relPath: "Acme" },
      { name: "Reports", relPath: "Acme/Reports" },
    ]);
  });
  it("is just the root for an empty folder", () => {
    expect(diagramBreadcrumbs("")).toEqual([{ name: "Diagrams", relPath: "" }]);
  });
});

describe("collectDiagramFolderRelPaths", () => {
  it("lists every folder depth-first, sorted", () => {
    const diagramsTree = extractDiagramsTree(sampleTree);
    expect(collectDiagramFolderRelPaths(diagramsTree)).toEqual([
      "Acme",
      "Acme/Reports",
    ]);
  });
});
