import { describe, expect, it } from "vitest";
import { matchContentBucket, type ContentPrefix } from "./content-sync-dirs";

const buckets: ContentPrefix[] = [
  { bucket: "diagrams", prefix: "diagrams/" },
  { bucket: "notes", prefix: "notes/" },
  { bucket: "notes", prefix: "collections/" },
  { bucket: "tasks", prefix: "tasks/" },
  { bucket: "tasks", prefix: "upstarts/" },
  { bucket: "docs", prefix: "docs/" },
];

describe("matchContentBucket", () => {
  it("classifies content files by prefix", () => {
    expect(matchContentBucket(buckets, "tasks/2026-07-17.json")).toBe("tasks");
    expect(matchContentBucket(buckets, "notes/today.json")).toBe("notes");
    expect(matchContentBucket(buckets, "collections/reading.json")).toBe("notes");
    expect(matchContentBucket(buckets, "upstarts/app/upstart.sh")).toBe("tasks");
    expect(matchContentBucket(buckets, "docs/guides/skills.md")).toBe("docs");
    expect(matchContentBucket(buckets, "diagrams/arch.json")).toBe("diagrams");
  });

  it("returns null for non-content paths", () => {
    expect(matchContentBucket(buckets, "dashboard/lib/repos.ts")).toBeNull();
    expect(matchContentBucket(buckets, "tasks.ts")).toBeNull();
    expect(matchContentBucket(buckets, "src/tasks/queue.ts")).toBeNull();
  });

  it("prefers the first matching prefix (diagrams before a nested notes dir)", () => {
    const nested: ContentPrefix[] = [
      { bucket: "diagrams", prefix: "notes/diagrams/" },
      { bucket: "notes", prefix: "notes/" },
    ];
    expect(matchContentBucket(nested, "notes/diagrams/arch.json")).toBe("diagrams");
    expect(matchContentBucket(nested, "notes/today.json")).toBe("notes");
  });
});
