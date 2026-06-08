import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDENTITY_MARKER_END,
  IDENTITY_MARKER_START,
  MARKER_END,
  MARKER_START,
  extractPersonaBlock,
} from "./persona-meta";
import { syncPersona } from "./sync-persona";

const tmpDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-persona-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "persona"), { recursive: true });
  fs.writeFileSync(path.join(dir, "persona", "shared-persona.md"), "# L1\nStandards here.\n");
  fs.writeFileSync(path.join(dir, "persona", "identity.txt"), "# L0\nTone here.\n");
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("extractPersonaBlock", () => {
  it("extracts content between markers", () => {
    const raw = `before\n${MARKER_START}\npayload\n${MARKER_END}\nafter`;
    expect(extractPersonaBlock(raw, MARKER_START, MARKER_END)).toBe("payload");
  });
});

describe("syncPersona", () => {
  it("injects identity and shared persona into repo AGENTS.md", async () => {
    const repoRoot = makeRepo();
    const agentsPath = path.join(repoRoot, "AGENTS.md");
    fs.writeFileSync(agentsPath, "## Project rules\nKeep me.\n");

    const lines: string[] = [];
    const code = await syncPersona({
      repoRoot,
      tool: "generic-agents",
      emit: (l) => lines.push(l),
    });
    expect(code).toBe(0);

    const out = fs.readFileSync(agentsPath, "utf-8");
    expect(out).toContain("## Project rules");
    expect(out).toContain("Standards here.");
    expect(out).toContain("Tone here.");
    expect(extractPersonaBlock(out, IDENTITY_MARKER_START, IDENTITY_MARKER_END)?.trim()).toBe(
      "# L0\nTone here.",
    );
    expect(extractPersonaBlock(out, MARKER_START, MARKER_END)?.trim()).toBe(
      "# L1\nStandards here.",
    );
  });
});
