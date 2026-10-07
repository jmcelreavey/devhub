import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSkillForRead } from "@/lib/skill-catalog";
import { getWritingVoicePrompt } from "./writing-voice";

vi.mock("@/lib/content/dirs", () => ({ getRepoRoot: () => "/test-repo" }));
vi.mock("@/lib/skill-catalog", () => ({ resolveSkillForRead: vi.fn() }));

let skillDir: string;

beforeEach(() => {
  skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "writing-voice-"));
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# My voice\nUse British spelling.");
  fs.writeFileSync(path.join(skillDir, "writing-style.md"), "Lead with the point.");
  vi.mocked(resolveSkillForRead).mockReturnValue({
    file: path.join(skillDir, "SKILL.md"),
    dir: skillDir,
    source: "devhub",
    readOnly: false,
  });
});

afterEach(() => {
  fs.rmSync(skillDir, { recursive: true, force: true });
  vi.resetAllMocks();
});

describe("getWritingVoicePrompt", () => {
  it("loads the skill and style guide for API writers in full-voice mode", () => {
    const prompt = getWritingVoicePrompt();
    expect(resolveSkillForRead).toHaveBeenCalledWith("/test-repo", "my-voice");
    expect(prompt).toContain("full-voice");
    expect(prompt).toContain("on the user's behalf");
    expect(prompt).toContain("Use British spelling.");
    expect(prompt).toContain("Lead with the point.");
    expect(prompt).toContain("requested output format exact");
  });

  it("adds the trained voice once the /voice trainer has written one", () => {
    expect(getWritingVoicePrompt()).not.toContain("Thanks first, always.");
    fs.writeFileSync(path.join(skillDir, "learned-voice.md"), "Thanks first, always.");
    expect(getWritingVoicePrompt()).toContain("Thanks first, always.");
  });

  it("leaves installations without a personal voice skill unchanged", () => {
    vi.mocked(resolveSkillForRead).mockReturnValue(null);
    expect(getWritingVoicePrompt()).toBe("");
  });

  it("uses updated guidance on the next request", () => {
    getWritingVoicePrompt();
    fs.writeFileSync(path.join(skillDir, "writing-style.md"), "Keep paragraphs short.");
    expect(getWritingVoicePrompt()).toContain("Keep paragraphs short.");
  });

  it("reports a broken skill instead of silently ignoring it", () => {
    fs.unlinkSync(path.join(skillDir, "writing-style.md"));
    expect(() => getWritingVoicePrompt()).toThrow();
  });
});
