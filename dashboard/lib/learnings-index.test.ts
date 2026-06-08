import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLearningEntries, readLearningDetail } from "./learnings-index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkLearningsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-learnings-"));
  dirs.push(dir);
  return dir;
}

const headingBlock = (text: string) => [
  { id: "1", type: "heading", props: { level: 1 }, content: [{ type: "text", text, styles: {} }], children: [] },
];

describe("learnings-index", () => {
  it("lists nested learnings recursively", () => {
    const dir = mkLearningsDir();
    fs.mkdirSync(path.join(dir, "web"), { recursive: true });
    fs.writeFileSync(path.join(dir, "engineering.json"), JSON.stringify(headingBlock("Engineering tips")));
    fs.writeFileSync(path.join(dir, "web", "feature-flags.json"), JSON.stringify(headingBlock("Feature flags")));
    const entries = listLearningEntries(dir);
    expect(entries.map((e) => e.category).sort()).toEqual(["engineering", "web/feature-flags"]);
  });

  it("reads nested learning detail by slug", () => {
    const dir = mkLearningsDir();
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "vim.json"), JSON.stringify(headingBlock("Vim notes")));
    const detail = readLearningDetail(dir, "tools/vim");
    expect(detail?.title).toBe("Vim notes");
  });
});
