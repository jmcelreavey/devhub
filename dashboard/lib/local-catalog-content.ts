import fs from "node:fs";
import { scanLocalAgentImportCandidates } from "./collect-agents";
import { scanLocalSkillImportCandidates } from "./collect-skills";
import { newestLocalSource } from "./local-catalog-compare";
import { SKILL_MD } from "./skills-shared";

export function readLocalSkillContent(repoRoot: string, name: string): string | null {
  const candidate = scanLocalSkillImportCandidates(repoRoot).find((c) => c.name === name);
  if (!candidate) return null;
  const source = newestLocalSource(candidate.sources);
  if (!source) return null;
  const file = source.kind === "skill" ? `${source.absPath}/${SKILL_MD}` : source.absPath;
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

export function readLocalAgentContent(repoRoot: string, name: string): string | null {
  const candidate = scanLocalAgentImportCandidates(repoRoot).find((c) => c.name === name);
  if (!candidate) return null;
  const source = newestLocalSource(candidate.sources);
  if (!source) return null;
  if (!fs.existsSync(source.absPath)) return null;
  return fs.readFileSync(source.absPath, "utf8");
}
