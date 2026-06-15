import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepoLearningProfile } from "./repo-learning";

let tmpRoot: string | null = null;

function writeFile(repoPath: string, relativePath: string, content: string): void {
  const fullPath = path.join(repoPath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeRepo(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-learning-"));
  const repoPath = path.join(tmpRoot, "sample-app");
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  return repoPath;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("buildRepoLearningProfile", () => {
  it("detects stack, commands, docs, and creates onboarding artifacts", async () => {
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

    const profile = await buildRepoLearningProfile(repoPath);

    expect(profile.repoName).toBe("sample-app");
    expect(profile.primaryStack).toEqual(expect.arrayContaining(["Next.js", "React", "TypeScript", "API routes"]));
    expect(profile.runCommands).toContain("npm run dev");
    expect(profile.testCommands).toEqual(expect.arrayContaining(["npm run test", "npm run typecheck"]));
    expect(profile.docs).toContain("README.md");
    expect(profile.keyDirectories).toEqual(expect.arrayContaining(["app", "src"]));
    expect(profile.briefMarkdown).toContain("# sample-app repo brief");
    expect(profile.notebookPackMarkdown).toContain("## Source excerpts");
    expect(profile.openCodePrompt).toContain("Do not modify files.");
    expect(profile.quiz.length).toBeGreaterThanOrEqual(5);
  });

  it("excludes secret-looking files from NotebookLM packs", async () => {
    const repoPath = makeRepo();
    writeFile(repoPath, "README.md", "# Safe docs");
    writeFile(repoPath, ".env", "TOKEN=do-not-include");
    writeFile(repoPath, "docs/credential-notes.md", "secret-ish");

    const profile = await buildRepoLearningProfile(repoPath);

    expect(profile.notebookPackMarkdown).toContain("# Safe docs");
    expect(profile.notebookPackMarkdown).not.toContain("do-not-include");
    expect(profile.notebookPackMarkdown).not.toContain("secret-ish");
  });
});
