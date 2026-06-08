import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { withErrorHandler } from "@/lib/api-utils";
import { buildAiToolsMeta, createSkillCatalogContext, listSkillsFromCatalog } from "@/lib/skill-catalog";
import { devhubSharedSkillsDir, SKILL_SLUG } from "@/lib/skills-shared";

export const GET = withErrorHandler(async () => {
  const repoRoot = getRepoRoot();
  const ctx = createSkillCatalogContext(repoRoot);
  return NextResponse.json({
    skills: listSkillsFromCatalog(ctx.entries),
    aiTools: buildAiToolsMeta(repoRoot),
  });
}, "skills");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as { name?: string; description?: string };
  const raw = body.name?.trim().toLowerCase() ?? "";
  if (!raw || !SKILL_SLUG.test(raw)) {
    return NextResponse.json(
      {
        error:
          "Invalid name — use lowercase letters, numbers, hyphen, underscore (e.g. my-skill).",
      },
      { status: 400 },
    );
  }
  const repoRoot = getRepoRoot();
  const skillsDir = devhubSharedSkillsDir(repoRoot);
  const dir = path.join(skillsDir, raw);
  const resolvedDir = path.resolve(dir);
  const resolvedParent = path.resolve(skillsDir);
  if (path.dirname(resolvedDir) !== resolvedParent) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (fs.existsSync(resolvedDir)) {
    return NextResponse.json({ error: "Skill already exists" }, { status: 409 });
  }
  fs.mkdirSync(resolvedDir, { recursive: true });
  const desc = body.description?.trim() || `Skill ${raw}`;
  const content = `# Skill: ${raw}\n\ndescription: ${desc}\n\n## When to Use\n\n- \n\n## How to Use\n\n\n`;
  fs.writeFileSync(path.join(resolvedDir, "SKILL.md"), content, "utf-8");
  return NextResponse.json({ ok: true, name: raw });
}, "skills");
