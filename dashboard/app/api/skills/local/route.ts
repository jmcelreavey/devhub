import { NextResponse } from "next/server";
import { getCheckoutRoot, getResourceRoot } from "@/lib/desktop/runtime-paths";
import { scanLocalSkillImportCandidates } from "@/lib/collect/skills";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** Skills found under ~/.claude/skills, ~/.codex/skills, etc. (for selective import UI). */
export const GET = withErrorHandler(async () => {
  // Blocking decisions (vendored / externally owned) and drift status must
  // match the catalog the importer actually writes to — the linked checkout,
  // not the packaged resource snapshot.
  const root = getCheckoutRoot() ?? getResourceRoot();
  const candidates = scanLocalSkillImportCandidates(root);
  return NextResponse.json({ candidates });
}, "skills.local");
