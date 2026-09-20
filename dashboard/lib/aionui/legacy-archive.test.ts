import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveLegacyChats, listLegacyArchives, readLegacyArchive } from "./legacy-archive";
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chat-archive-")); vi.stubEnv("NOTES_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
describe("legacy chat archive", () => {
  it("preserves the exact original export, is repeatable, and stores it privately", () => {
    const raw = '{"history":"  exact\\ntext", "draft":"unsent"}';
    const first = archiveLegacyChats(raw);
    expect(archiveLegacyChats(raw)).toEqual(first);
    expect(readLegacyArchive(first.id)?.raw).toBe(raw);
    expect(listLegacyArchives()).toHaveLength(1);
    expect(fs.statSync(path.join(root, ".config/agent-chat-archive", first.id + ".json")).mode & 0o777).toBe(0o600);
    expect(readLegacyArchive("../../elsewhere")).toBeNull();
  });
  it("refuses to acknowledge a damaged existing archive", () => {
    const archive = archiveLegacyChats("original");
    fs.writeFileSync(path.join(root, ".config/agent-chat-archive", archive.id + ".json"), JSON.stringify({ ...archive, raw: "damaged" }));
    expect(() => archiveLegacyChats("original")).toThrow("could not be verified");
  });
});
