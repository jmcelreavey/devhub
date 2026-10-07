import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "@/lib/ai/generate";
import { getWritingVoicePrompt } from "@/lib/ai/writing-voice";
import { getRepoRoot } from "@/lib/content/dirs";
import type { Task } from "@/lib/tasks/types";
import { draftJiraTicket } from "./draft-ticket";

vi.mock("@/lib/ai/generate", () => ({ generateAiText: vi.fn() }));
vi.mock("@/lib/entity-links/resolve", () => ({
  resolveEntityContext: () => ({ notes: [], related: [], expanded: [] }),
}));
vi.mock("@/lib/plugins/registry", () => ({ pluginAssetDirs: () => [] }));
vi.mock("@/lib/tasks/implement-ready-gather", () => ({
  resolveTaskNotePath: () => "task-notes/test",
  readTaskNoteMarkdown: () => null,
  fetchJiraDescriptionText: vi.fn(),
}));

const task: Task = {
  id: "test-task", text: "Preserve renewal event ordering", done: false,
  createdAt: "2026-10-07T09:00:00Z",
};
const draft = {
  summary: "Preserve renewal event ordering during retries",
  description: "Keep renewal events in their original sequence when delivery is retried.",
};
let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jira-draft-desktop-"));
  const resourceRoot = path.join(fixtureRoot, "resources");
  vi.stubEnv("DEVHUB_DESKTOP", "1");
  vi.stubEnv("DEVHUB_APP_DATA", path.join(fixtureRoot, "user-data"));
  vi.stubEnv("DEVHUB_RESOURCE_ROOT", resourceRoot);
  vi.stubEnv("AI_TOOLS_SYNC", "0");
  vi.stubEnv("REPO_ROOT", "");

  const draftDir = path.join(resourceRoot, "skills", "shared", "devhub-draft-jira-ticket");
  fs.mkdirSync(draftDir, { recursive: true });
  fs.copyFileSync(
    fileURLToPath(new URL("../../../skills/shared/devhub-draft-jira-ticket/SKILL.md", import.meta.url)),
    path.join(draftDir, "SKILL.md"),
  );

  const voiceDir = path.join(resourceRoot, "skills", "shared", "my-voice");
  fs.mkdirSync(voiceDir, { recursive: true });
  fs.writeFileSync(path.join(voiceDir, "SKILL.md"), "# My voice\nUse British spelling.");
  fs.writeFileSync(path.join(voiceDir, "writing-style.md"), "Lead with the point.");
  fs.writeFileSync(path.join(voiceDir, "learned-voice.md"), "Keep ticket titles specific.");
  vi.mocked(generateAiText).mockResolvedValue({ text: JSON.stringify(draft), provider: "api" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("Jira drafting in the installed app", () => {
  it("loads the bundled drafting skill when the user-data folder has no skills or checkout", async () => {
    expect(getRepoRoot()).toBe(path.join(fixtureRoot, "user-data"));

    await expect(draftJiraTicket(task, "2026-10-07")).resolves.toEqual({ ...draft, warnings: [] });

    const options = vi.mocked(generateAiText).mock.calls[0]![0];
    expect(options.system).toContain("# Draft Jira Ticket");
    expect(options.system).toContain("Use British spelling.");
    expect(options.system).toContain("Lead with the point.");
    expect(options.system).toContain("Keep ticket titles specific.");
  });

  it("loads the installed voice guidance independently of the writable content root", () => {
    expect(getWritingVoicePrompt()).toContain("Keep ticket titles specific.");
  });
});
