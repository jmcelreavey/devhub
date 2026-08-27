import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENTS_IDENTITY_STUB,
  AGENTS_SHARED_STUB,
  IDENTITY_MARKER_END,
  IDENTITY_MARKER_START,
  MARKER_END,
  MARKER_START,
  extractPersonaBlock,
} from "@/lib/persona-meta";
import { syncPersona } from "@/lib/sync/persona";

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
  it("writes L0/L1 pointers into repo AGENTS.md, not the full persona text", async () => {
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
    expect(out).toContain("Keep me.");
    expect(out).not.toContain("Standards here.");
    expect(out).not.toContain("Tone here.");
    expect(extractPersonaBlock(out, IDENTITY_MARKER_START, IDENTITY_MARKER_END)?.trim()).toBe(
      AGENTS_IDENTITY_STUB,
    );
    expect(extractPersonaBlock(out, MARKER_START, MARKER_END)?.trim()).toBe(AGENTS_SHARED_STUB);
  });
});
