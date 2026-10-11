import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/agent-runs/dispatch", () => ({ AgentDispatchError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { selectionPath } from "./workspace";
import { SelectionSchema, selectionContext } from "./selection";
const roots: string[] = [];
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-selection-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("selection boundaries", () => {
  it("keeps Unicode and deleted diff lines in the captured snapshot", () => {
    const input = SelectionSchema.parse({ workspaceId: "app", relativePath: "a.ts", revision: "snapshot", ranges: "old 2–4", selectedText: "- const café = '☕';\n+ const café = 'tea';", source: "staged", dirty: true });
    expect(selectionContext(input)).toContain("> - const café = '☕';");
    expect(selectionContext(input)).toContain("Source: staged");
    expect(() => SelectionSchema.parse({ ...input, selectedText: "x".repeat(12001) })).toThrow();
  });
  it("allows deleted files while rejecting traversal, credential paths and symlink escapes", () => {
    const root = temp(); const other = temp();
    expect(selectionPath(root, "deleted.ts")).toBe(path.join(fs.realpathSync(root), "deleted.ts"));
    for (const file of ["../x", "/tmp/x", ".env.local", "dir/secrets.json", ".git/config", "key.pem"]) expect(() => selectionPath(root, file)).toThrow();
    fs.symlinkSync(other, path.join(root, "outside"));
    expect(() => selectionPath(root, "outside/deleted.ts")).toThrow("symlink");
  });
});
