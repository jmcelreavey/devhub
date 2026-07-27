import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRepoLearnCache, buildPackZip } from "@/lib/repos/learn-cache";
import { useTempContentRoot, type ContentRoot } from "@/lib/testing/content-root";

let content: ContentRoot | null = null;

afterEach(() => {
  content?.cleanup();
  content = null;
});

describe("repo-learn-cache", () => {
  it("invalidates when gitHead changes", async () => {
    content = useTempContentRoot("repo-learn-cache-");
    const tmpRoot = content.root;
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

    expect(readRepoLearnCache("demo", "abc123")?.briefMarkdown).toBe("# Brief");
    expect(readRepoLearnCache("demo", "def456")).toBeNull();
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
