import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRepo } from "./validate";

describe("public core validation", () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-validate-"));
    output = [];
    const files: Record<string, string> = {
      ".gitignore": "node_modules\n.next\n.env\n",
      "persona/shared-persona.md": "Shared engineering standards",
      "skills/shared/deep-preferences/SKILL.md": "---\nname: deep-preferences\ndescription: Use when explaining engineering work.\n---\n",
      "mcp/shared/devhub.json": JSON.stringify({ command: "node", args: ["server.js"] }),
      "mcp-servers/devhub-server/src/mcp.ts": "// MCP server fixture",
      "dashboard/package.json": "{}",
    };
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts a fresh public core without a private identity", async () => {
    const result = await validateRepo({ repoRoot: root, emit: (line) => output.push(line) });
    expect(result).toBe(0);
    expect(output.join("\n")).toContain("No personal identity yet");
  });

  it("still fails when required shared persona sources are missing", async () => {
    fs.unlinkSync(path.join(root, "persona/shared-persona.md"));
    const result = await validateRepo({ repoRoot: root, emit: (line) => output.push(line) });
    expect(result).toBe(1);
    expect(output.join("\n")).toContain("persona/shared-persona.md missing");
  });
});
