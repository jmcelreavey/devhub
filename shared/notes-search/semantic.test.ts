import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { semanticSearchNotes } from "./semantic.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("semanticSearchNotes", () => {
  it("ranks by relevance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-"));
    dirs.push(root);
    const block = [{ id: "1", type: "paragraph", props: {}, content: [{ type: "text", text: "kubernetes deployment", styles: {} }], children: [] }];
    fs.writeFileSync(path.join(root, "deploy.json"), JSON.stringify(block));
    fs.writeFileSync(path.join(root, "other.json"), JSON.stringify([{ ...block[0], content: [{ type: "text", text: "grocery list", styles: {} }] }]));
    const results = semanticSearchNotes(root, "kubernetes deployment");
    expect(results[0]?.path).toBe("deploy.json");
  });
});
