import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTaskAgentRunTaskIds } from "./task-agent-runs";

describe("listTaskAgentRunTaskIds", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores _index.json and _index.local.json", () => {
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runs-"));
    dirs.push(notes);
    const dir = path.join(notes, ".config", "task-agent-runs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "_index.json"), "{}");
    fs.writeFileSync(path.join(dir, "_index.local.json"), "{}");
    fs.writeFileSync(path.join(dir, "task-1.json"), "{}");
    expect(listTaskAgentRunTaskIds(notes)).toEqual(["task-1"]);
  });
});
