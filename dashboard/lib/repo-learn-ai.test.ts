import { describe, expect, it, vi } from "vitest";
import {
  buildBriefPrompt,
  buildPackPrompt,
  buildTutorSystemPrompt,
  parsePackSections,
} from "./repo-learn-ai";
import type { RepoContext } from "./repo-context";

vi.mock("@/lib/ai-provider", () => ({
  getNotesAiModel: vi.fn(),
  getNotesAiCallOptions: vi.fn(() => ({})),
}));

const sampleContext: RepoContext = {
  repoName: "demo-app",
  repoPath: "/tmp/demo-app",
  scannedAt: new Date().toISOString(),
  headline: "Next.js. Key dirs: app.",
  primaryStack: ["Next.js", "TypeScript"],
  packageManager: "npm",
  scripts: { dev: "next dev", test: "vitest run" },
  keyDirectories: ["app", "lib"],
  docs: ["README.md"],
  manifests: ["package.json"],
  testCommands: ["npm run test"],
  runCommands: ["npm run dev"],
  recentCommits: ["abc123 init"],
  languageBreakdown: [{ extension: ".ts", count: 10 }],
  snippets: [{ relativePath: "README.md", text: "# Demo" }],
  openCodePrompt: "help me learn",
};

describe("repo-learn-ai prompts", () => {
  it("includes repo facts and paths in brief prompt", () => {
    const prompt = buildBriefPrompt(sampleContext);
    expect(prompt).toContain("demo-app");
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("npm run dev");
  });

  it("requests structured pack sections", () => {
    const prompt = buildPackPrompt(sampleContext);
    expect(prompt).toContain("00-overview.md");
    expect(prompt).toContain("01-architecture.md");
    expect(prompt).toContain("packSections");
  });

  it("includes Socratic rules in tutor system prompt", () => {
    const prompt = buildTutorSystemPrompt(sampleContext);
    expect(prompt).toContain("Socratic");
    expect(prompt).toContain("gap-explained");
    expect(prompt).toContain("demo-app");
  });

  it("parses pack JSON from model output", () => {
    const raw = JSON.stringify({
      packSections: [{ path: "00-overview.md", content: "# Overview" }],
    });
    expect(parsePackSections(raw)).toEqual([
      { path: "00-overview.md", content: "# Overview" },
    ]);
  });
});
