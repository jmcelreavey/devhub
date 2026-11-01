import { skillCatalogCreate } from "../../../../../../packages/shared/actions/workspace";
import { skillsList } from "../../../../../../packages/shared/actions/workspace";
import fs from "node:fs";
import path from "node:path";
import { getResourceRoot } from "../../../lib/desktop/runtime-paths";
import { withErrorHandler } from "../../../lib/api-utils";
import { buildAiToolsMeta, createSkillCatalogContext, listSkillsFromCatalog } from "../../../lib/skills/catalog";
import { devhubSharedSkillsDir, SKILL_SLUG } from "../../../lib/skills/shared";

export const GET = withErrorHandler(async () => {
  return await skillsList.handler({}, { execute: async () => {
    const repoRoot = getResourceRoot();
    const ctx = createSkillCatalogContext(repoRoot);
    return Response.json({
      skills: listSkillsFromCatalog(ctx.entries),
      aiTools: buildAiToolsMeta(repoRoot),
    });
  } }) as Response;
}, "skills");

export const POST = withErrorHandler(async (req: Request) => {
  const body = (await req.json()) as { name?: string; description?: string };
  const raw = body.name?.trim().toLowerCase() ?? "";
  if (!raw || !SKILL_SLUG.test(raw)) {
    return Response.json(
      {
        error:
          "Invalid name — use lowercase letters, numbers, hyphen, underscore (e.g. my-skill).",
      },
      { status: 400 },
    );
  }
  const repoRoot = getResourceRoot();
  const skillsDir = devhubSharedSkillsDir(repoRoot);
  const dir = path.join(skillsDir, raw);
  const resolvedDir = path.resolve(dir);
  const resolvedParent = path.resolve(skillsDir);
  if (path.dirname(resolvedDir) !== resolvedParent) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  if (fs.existsSync(resolvedDir)) {
    return Response.json({ error: "Skill already exists" }, { status: 409 });
  }

  return await skillCatalogCreate.handler({ name: raw, description: body.description }, { execute: async () => {
    fs.mkdirSync(resolvedDir, { recursive: true });
    const desc = body.description?.trim() || `Skill ${raw}`;
    const content = `# Skill: ${raw}\n\ndescription: ${desc}\n\n## When to Use\n\n- \n\n## How to Use\n\n\n`;
    fs.writeFileSync(path.join(resolvedDir, "SKILL.md"), content, "utf-8");
    return Response.json({ ok: true, name: raw });
  } }) as Response;
}, "skills");
