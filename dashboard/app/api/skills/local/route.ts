import { NextResponse } from "next/server";
import { getRepoRoot } from "@/lib/notes-dir";
import { scanLocalSkillImportCandidates } from "@/lib/collect-skills";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** Skills found under ~/.claude/skills, ~/.codex/skills, etc. (for selective import UI). */
export const GET = withErrorHandler(async () => {
  const candidates = scanLocalSkillImportCandidates(getRepoRoot());
  return NextResponse.json({ candidates });
}, "skills.local");
