import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENT_SYNC_PATHS, isContentSyncPath } from "@/lib/content/sync-paths";
import { matchContentBucket, type ContentPrefix } from "@/lib/content/sync-dirs";

const buckets: ContentPrefix[] = [
  { bucket: "diagrams", prefix: "diagrams/" },
  { bucket: "notes", prefix: "notes/" },
  { bucket: "notes", prefix: "collections/" },
  { bucket: "tasks", prefix: "tasks/" },
  { bucket: "tasks", prefix: "upstarts/" },
  { bucket: "docs", prefix: "docs/" },
];

describe("matchContentBucket", () => {
  it("includes every conventional hidden content folder in scoped sync", () => {
    for (const { prefix } of buckets) {
      expect(CONTENT_SYNC_PATHS).toContain(prefix.slice(0, -1));
      expect(isContentSyncPath(`${prefix}example.json`)).toBe(true);
    }
  });

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

  it("syncs task items and leaves timer overlays on the machine", () => {
    for (const file of [
      "tasks/items/a.json",
      "tasks/legacy/2026-09-01.json",
      "tasks/deleted/a.json",
      "tasks/work/items/a.json",
    ]) {
      expect(isContentSyncPath(file)).toBe(true);
      expect(matchContentBucket(buckets, file)).toBe("tasks");
    }
    for (const file of ["tasks/.local/timers.json", "tasks/work/.local/timers.json"]) {
      expect(isContentSyncPath(file)).toBe(false);
      expect(matchContentBucket(buckets, file)).toBeNull();
    }
    const gitignore = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.gitignore"), "utf8");
    expect(gitignore).toContain("tasks/.local/");
    expect(gitignore).toContain("tasks/*/.local/");
  });
});
