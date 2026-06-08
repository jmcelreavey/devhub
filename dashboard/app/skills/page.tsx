import { Suspense } from "react";
import { getRepoRoot } from "@/lib/notes-dir";
import { buildAiToolsMeta, listSkillsForApi } from "@/lib/skill-catalog";
import type { SkillsListResponse } from "@/lib/skills-api-types";
import Client from "./client";

export default function SkillsPage() {
  const repoRoot = getRepoRoot();
  const initialCatalog: SkillsListResponse = {
    skills: listSkillsForApi(repoRoot),
    aiTools: buildAiToolsMeta(repoRoot),
  };
  return (
    <Suspense fallback={<div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>}>
      <Client initialCatalog={initialCatalog} />
    </Suspense>
  );
}
