import { describe, expect, it } from "vitest";
import {
  DIAGRAM_ROOT_AREA_ID,
  diagramBrowseModelFromTree,
  groupDiagramsByArea,
} from "./diagram-browse";
import type { DiagramTreeEntry } from "@/lib/diagram-utils";

const sample: DiagramTreeEntry[] = [
  {
    type: "dir",
    name: "Acme",
    path: "diagrams/Acme",
    children: [
      {
        type: "dir",
        name: "JobAgent",
        path: "diagrams/Acme/JobAgent",
        children: [
          {
            type: "file",
            name: "Legal architecture overview.json",
            path: "diagrams/Acme/JobAgent/Legal architecture overview.json",
            modified: 200,
          },
          {
            type: "file",
            name: "End-to-end architecture.json",
            path: "diagrams/Acme/JobAgent/End-to-end architecture.json",
            modified: 100,
          },
        ],
      },
    ],
  },
  {
    type: "file",
    name: "top-level.json",
    path: "diagrams/top-level.json",
    modified: 50,
  },
];

describe("diagramBrowseModelFromTree", () => {
  it("groups by top-level area and sorts recent by mtime", () => {
    const model = diagramBrowseModelFromTree(sample);
    expect(model.total).toBe(3);
    expect(model.areas.map((a) => a.id)).toEqual(["Acme", DIAGRAM_ROOT_AREA_ID]);
    const acme = model.areas.find((a) => a.id === "Acme");
    expect(acme?.folderCount).toBe(1);
    expect(acme?.diagrams.map((d) => d.name)).toEqual([
      "Legal architecture overview",
      "End-to-end architecture",
    ]);
    expect(acme?.diagrams[0]?.path).toBe(
      "diagrams/Acme/JobAgent/Legal architecture overview",
    );
    expect(model.recent[0]?.name).toBe("Legal architecture overview");
  });
});

describe("groupDiagramsByArea", () => {
  it("groups by area, sorts by mtime, and appends root", () => {
    const diagrams = [
      { path: "diagrams/Acme/a", name: "a", href: "/diagrams/Acme/a", area: "Acme", modified: 1 },
      { path: "diagrams/Acme/b", name: "b", href: "/diagrams/Acme/b", area: "Acme", modified: 3 },
      { path: "diagrams/root", name: "root", href: "/diagrams/root", area: "", modified: 2 },
    ];
    const areas = groupDiagramsByArea(diagrams, [{ id: "Acme", folderCount: 1 }]);
    expect(areas.map((a) => a.id)).toEqual(["Acme", DIAGRAM_ROOT_AREA_ID]);
    expect(areas[0]?.diagrams.map((d) => d.name)).toEqual(["b", "a"]);
    expect(areas[0]?.folderCount).toBe(1);
    expect(areas[1]?.label).toBe("Top level");
    expect(areas[1]?.diagrams.map((d) => d.name)).toEqual(["root"]);
  });
});
