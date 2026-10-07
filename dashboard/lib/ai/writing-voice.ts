import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/content/dirs";
import { resolveSkillForRead } from "@/lib/skill-catalog";
import { LEARNED_VOICE_FILE, STYLE_GUIDE_FILE, VOICE_SKILL } from "@/lib/voice/skill";

/** API models cannot open skills themselves, so provide the installed guidance. */
export function getWritingVoicePrompt(): string {
  const skill = resolveSkillForRead(getRepoRoot(), VOICE_SKILL);
  if (!skill) return "";

  // Absent until the first /voice training round, so unlike the style guide it isn't an error.
  const learnedFile = path.join(skill.dir, LEARNED_VOICE_FILE);
  const learned = fs.existsSync(learnedFile) ? fs.readFileSync(learnedFile, "utf8") : "";

  return [
    "Apply my-voice in full-voice mode to prose written on John's behalf.",
    "Keep technical facts, quoted content, identifiers, and the requested output format exact.",
    fs.readFileSync(skill.file, "utf8"),
    fs.readFileSync(path.join(skill.dir, STYLE_GUIDE_FILE), "utf8"),
    learned,
  ]
    .filter(Boolean)
    .join("\n\n");
}
