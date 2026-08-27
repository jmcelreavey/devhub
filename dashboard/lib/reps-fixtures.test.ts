import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isColdReadCandidate, parseNumstatLog } from "@/lib/reps-generate";

const FIXTURE = path.join(process.cwd(), "test/fixtures/reps/cold-read.json");

describe("daily reps fixtures", () => {
  it("loads the cold-read fixture shape", () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as {
      kind: string;
      repo: string;
      material: { files: string[] };
    };
    expect(raw.kind).toBe("cold-read");
    expect(raw.material.files.length).toBeGreaterThan(0);
  });

  it("parses numstat log for fixture repo", () => {
    const log = "\u001eabc123\u00002026-08-20T10:00:00Z\u0000peer@example.com\u0000Peer Author\u0000fix: empty payloads\n30\t10\tsrc/handler.ts\n5\t2\tsrc/handler.test.ts\n";
    const commits = parseNumstatLog("org/widgets", log);
    expect(commits).toHaveLength(1);
    expect(isColdReadCandidate(commits[0]!, "me@example.com")).toBe(true);
  });
});
