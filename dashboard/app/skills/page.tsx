import { Suspense } from "react";
import { getRepoRoot } from "@/lib/notes-dir";
import { buildAiToolsMeta, listSkillsForApi } from "@/lib/skill-catalog";
import type { SkillsListResponse } from "@/lib/skills-api-types";
import { BootScreen } from "@/components/TodayBootScreen";
import Client from "./client";

export default function SkillsPage() {
  const repoRoot = getRepoRoot();
  const initialCatalog: SkillsListResponse = {
    skills: listSkillsForApi(repoRoot),
    aiTools: buildAiToolsMeta(repoRoot),
  };
  return (
    <Suspense fallback={<BootScreen state="loading" />}>
      <Client initialCatalog={initialCatalog} />
    </Suspense>
  );
}
