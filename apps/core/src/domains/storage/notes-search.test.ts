import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { searchNotes } from "../../../../../packages/shared/notes-search/search.ts";

it.skipIf(process.platform === "win32")("does not search note symlinks outside the vault", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-search-"));
  try {
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    const outside = path.join(root, "outside.json");
    fs.writeFileSync(outside, JSON.stringify([{ content: [{ type: "text", text: "outside-secret" }] }]));
    fs.symlinkSync(outside, path.join(vault, "linked.json"));
    expect(searchNotes(vault, "outside-secret")).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
