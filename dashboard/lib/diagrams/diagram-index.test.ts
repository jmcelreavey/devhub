import { describe, expect, it } from "vitest";
import {
  DIAGRAM_ROOT_AREA_ID,
  diagramBrowseModelFromTree,
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
