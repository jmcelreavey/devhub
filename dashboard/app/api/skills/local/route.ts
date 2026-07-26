import { NextResponse } from "next/server";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { scanLocalSkillImportCandidates } from "@/lib/collect/skills";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** Skills found under ~/.claude/skills, ~/.codex/skills, etc. (for selective import UI). */
export const GET = withErrorHandler(async () => {
  const candidates = scanLocalSkillImportCandidates(getResourceRoot());
  return NextResponse.json({ candidates });
}, "skills.local");
