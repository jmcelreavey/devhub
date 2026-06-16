import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepoContext, buildSnippetPackFiles } from "./repo-context";

let tmpRoot: string | null = null;

function writeFile(repoPath: string, relativePath: string, content: string): void {
  const fullPath = path.join(repoPath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeRepo(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-context-"));
  const repoPath = path.join(tmpRoot, "sample-app");
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  return repoPath;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("scanRepoContext", () => {
  it("detects stack, commands, docs, and snippets", async () => {
    const repoPath = makeRepo();
    writeFile(repoPath, "package.json", JSON.stringify({
      scripts: {
        dev: "next dev",
        test: "vitest run",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        next: "16.0.0",
        react: "19.0.0",
      },
      devDependencies: {
        typescript: "5.0.0",
      },
    }));
    writeFile(repoPath, "README.md", "# Sample App\n\nStart here.");
    writeFile(repoPath, "app/api/hello/route.ts", "export async function GET() {}");
    writeFile(repoPath, "src/index.ts", "export const ok = true;");

    const context = await scanRepoContext(repoPath);

    expect(context.repoName).toBe("sample-app");
    expect(context.primaryStack).toEqual(expect.arrayContaining(["Next.js", "React", "TypeScript", "API routes"]));
    expect(context.runCommands).toContain("npm run dev");
    expect(context.testCommands).toEqual(expect.arrayContaining(["npm run test", "npm run typecheck"]));
    expect(context.docs).toContain("README.md");
    expect(context.keyDirectories).toEqual(expect.arrayContaining(["app", "src"]));
    expect(context.openCodePrompt).toContain("Do not modify files.");
    expect(context.snippets.some((s) => s.relativePath === "README.md")).toBe(true);
  });

  it("excludes secret-looking files from snippets", async () => {
    const repoPath = makeRepo();
    writeFile(repoPath, "README.md", "# Safe docs");
    writeFile(repoPath, ".env", "TOKEN=do-not-include");
    writeFile(repoPath, "docs/credential-notes.md", "secret-ish");

    const context = await scanRepoContext(repoPath);
    const snippetPaths = context.snippets.map((s) => s.relativePath);

    expect(snippetPaths).toContain("README.md");
    expect(snippetPaths).not.toContain(".env");
    expect(snippetPaths).not.toContain("docs/credential-notes.md");
  });

  it("builds snippet pack files for ZIP export", async () => {
    const repoPath = makeRepo();
    writeFile(repoPath, "README.md", "# Hello");

    const context = await scanRepoContext(repoPath);
    const pack = buildSnippetPackFiles(context.snippets);

    expect(pack.length).toBeGreaterThan(0);
    expect(pack[0].path).toMatch(/^05-source-excerpts\//);
    expect(pack[0].content).toContain("# Hello");
  });
});
