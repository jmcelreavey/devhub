import { skillCatalogDelete } from "../../../../../../../packages/shared/actions/workspace";
import { skillCatalogRename } from "../../../../../../../packages/shared/actions/workspace";
import { skillCatalogSave } from "../../../../../../../packages/shared/actions/workspace";
import { skillsRead } from "../../../../../../../packages/shared/actions/workspace";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { rewriteAiToolsSkillFrontmatterName } from "../../../../lib/ai/tools-skills";
import { createSkillCatalogContext, resolveSkillInCatalog } from "../../../../lib/skills/catalog";
import {
  devhubSharedSkillsDir,
  READ_ONLY_UPSTREAM_SKILL_ERROR,
  SKILL_SLUG,
} from "../../../../lib/skills/shared";


function readOnlyResponse() {
  return Response.json({ error: READ_ONLY_UPSTREAM_SKILL_ERROR }, { status: 403 });
}

function invalidSlugResponse() {
  return Response.json({ error: "Invalid skill name" }, { status: 400 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  return await skillsRead.handler(skillsRead.input.parse({ name }), { execute: async () => {
    const repoRoot = getResourceRoot();
    const { entries } = createSkillCatalogContext(repoRoot);
    const skill = resolveSkillInCatalog(entries, name);
    if (!skill || !fs.existsSync(/*turbopackIgnore: true*/ skill.file)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const rawContent = fs.readFileSync(/*turbopackIgnore: true*/ skill.file, "utf-8");
    const content =
      skill.source === "ai-tools" ? rewriteAiToolsSkillFrontmatterName(rawContent, name) : rawContent;
    const stat = fs.statSync(/*turbopackIgnore: true*/ skill.file);
    return Response.json({
      name,
      content,
      revision: createHash("sha256").update(rawContent).digest("hex"),
      modified: stat.mtimeMs,
      source: skill.source,
      readOnly: skill.readOnly,
      overridesUpstream: skill.overridesUpstream,
    });
  } }) as Response;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getResourceRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.file)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();

  const body = await req.json();
  const { content } = body as { content: string };
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Content required" }, { status: 400 });
  }


  return await skillCatalogSave.handler({ name, content }, { execute: async () => {
    fs.writeFileSync(resolved.file, content, "utf-8");
    const stat = fs.statSync(resolved.file);
    return Response.json({ ok: true, name, modified: stat.mtimeMs });
  } }) as Response;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getResourceRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.dir)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return Response.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim().toLowerCase();
  if (!SKILL_SLUG.test(raw)) {
    return Response.json({ error: "Invalid name format" }, { status: 400 });
  }

  return await skillCatalogRename.handler({ name, newName: raw }, { execute: async () => {
    if (raw === name) {
      return Response.json({ ok: true, name });
    }

    const skillsDir = devhubSharedSkillsDir(repoRoot);
    const newDir = path.join(skillsDir, raw);
    if (path.resolve(newDir) !== path.join(path.resolve(skillsDir), raw)) {
      return Response.json({ error: "Invalid name" }, { status: 400 });
    }
    if (fs.existsSync(newDir)) {
      return Response.json({ error: "Name already taken" }, { status: 409 });
    }

    fs.renameSync(resolved.dir, newDir);
    return Response.json({ ok: true, name: raw });
  } }) as Response;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getResourceRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.dir)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();


  return await skillCatalogDelete.handler({ name }, { execute: async () => {
    fs.rmSync(resolved.dir, { recursive: true, force: true });
    return Response.json({ ok: true, name });
  } }) as Response;
}
