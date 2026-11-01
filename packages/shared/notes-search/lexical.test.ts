import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lexicalSearchNotes } from "./lexical.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("lexicalSearchNotes", () => {
  it("ranks by relevance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexical-"));
    dirs.push(root);
    const block = [{ id: "1", type: "paragraph", props: {}, content: [{ type: "text", text: "kubernetes deployment", styles: {} }], children: [] }];
    fs.writeFileSync(path.join(root, "deploy.json"), JSON.stringify(block));
    fs.writeFileSync(path.join(root, "other.json"), JSON.stringify([{ ...block[0], content: [{ type: "text", text: "grocery list", styles: {} }] }]));
    const results = lexicalSearchNotes(root, "kubernetes deployment");
    expect(results[0]?.path).toBe("deploy.json");
  });

  it.skipIf(process.platform === "win32")("does not search symlinked files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexical-"));
    dirs.push(root);
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    const local = path.join(vault, "local.json");
    const outside = path.join(root, "outside.json");
    const block = [{ content: [{ type: "text", text: "searchable keyword" }] }];
    fs.writeFileSync(local, JSON.stringify(block));
    fs.writeFileSync(outside, JSON.stringify(block));
    fs.symlinkSync(local, path.join(vault, "local-link.json"));
    fs.symlinkSync(outside, path.join(vault, "outside-link.json"));

    expect(lexicalSearchNotes(vault, "keyword").map((result) => result.path)).toEqual(["local.json"]);
  });
});
