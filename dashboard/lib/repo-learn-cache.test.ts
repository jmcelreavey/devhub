import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRepoLearnCache, buildPackZip } from "./repo-learn-cache";

let tmpRoot: string | null = null;

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("repo-learn-cache", () => {
  it("invalidates when gitHead changes", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-learn-cache-"));
    const notesDir = path.join(tmpRoot, "notes", ".cache", "repo-learn");
    fs.mkdirSync(notesDir, { recursive: true });
    const cachePath = path.join(notesDir, "demo.json");

    const entry = {
      repoName: "demo",
      gitHead: "abc123",
      generatedAt: new Date().toISOString(),
      briefMarkdown: "# Brief",
      packFiles: [{ path: "00-overview.md", content: "# Overview" }],
    };

    fs.writeFileSync(cachePath, JSON.stringify(entry));

    const originalRoot = process.env.REPO_ROOT;
    process.env.REPO_ROOT = tmpRoot;
    try {
      expect(readRepoLearnCache("demo", "abc123")?.briefMarkdown).toBe("# Brief");
      expect(readRepoLearnCache("demo", "def456")).toBeNull();
    } finally {
      if (originalRoot === undefined) delete process.env.REPO_ROOT;
      else process.env.REPO_ROOT = originalRoot;
    }
  });

  it("builds a zip buffer from pack files", () => {
    const zip = buildPackZip([
      { path: "00-overview.md", content: "# Hello" },
      { path: "README-import.md", content: "Import me" },
    ]);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
  });
});
