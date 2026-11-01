import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normaliseOpenCodeMcpEntry, repairOpenCodeDevhubMcp } from "./mcp";
const homes: string[] = [];
afterEach(() => homes.splice(0).forEach(home => fs.rmSync(home, { recursive: true, force: true })));
it("repairs legacy commands and env while dropping unsupported wrapper fields", () => {
  expect(normaliseOpenCodeMcpEntry({ command: "node", args: ["server.js"], env: { KEEP: "yes" }, autoApprove: ["x"], instructions: "wrapper only", enabled: false, timeout: 12000 }))
    .toEqual({ type: "local", command: ["node", "server.js"], environment: { KEEP: "yes" }, enabled: false, timeout: 12000 });
});
it("backs up the config and leaves other servers and settings intact", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-")); homes.push(home);
  const file = path.join(home, ".config", "opencode", "opencode.json");
  const original = { theme: "system", mcp: { devhub: { type: "local", command: ["node", "server.js"], env: { LOCAL: "value" }, autoApprove: ["all"] }, other: { enabled: false } } };
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(original));
  repairOpenCodeDevhubMcp(home);
  expect(JSON.parse(fs.readFileSync(file + ".devhub-backup", "utf8"))).toEqual(original);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ ...original, mcp: { ...original.mcp, devhub: { type: "local", command: ["node", "server.js"], environment: { LOCAL: "value" } } } });
});
it("refuses an invalid command instead of writing another broken entry", () => {
  expect(() => normaliseOpenCodeMcpEntry({ type: "local", command: [] })).toThrow("command");
});
