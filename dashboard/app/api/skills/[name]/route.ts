import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { rewriteAiToolsSkillFrontmatterName } from "@/lib/ai-tools-skills";
import { createSkillCatalogContext, resolveSkillInCatalog } from "@/lib/skill-catalog";
import {
  devhubSharedSkillsDir,
  READ_ONLY_UPSTREAM_SKILL_ERROR,
  SKILL_SLUG,
} from "@/lib/skills-shared";

export const dynamic = "force-dynamic";

function readOnlyResponse() {
  return NextResponse.json({ error: READ_ONLY_UPSTREAM_SKILL_ERROR }, { status: 403 });
}

function invalidSlugResponse() {
  return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getRepoRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const skill = resolveSkillInCatalog(entries, name);
  if (!skill || !fs.existsSync(/*turbopackIgnore: true*/ skill.file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rawContent = fs.readFileSync(/*turbopackIgnore: true*/ skill.file, "utf-8");
  const content =
    skill.source === "ai-tools" ? rewriteAiToolsSkillFrontmatterName(rawContent, name) : rawContent;
  const stat = fs.statSync(/*turbopackIgnore: true*/ skill.file);
  return NextResponse.json({
    name,
    content,
    modified: stat.mtimeMs,
    source: skill.source,
    readOnly: skill.readOnly,
    overridesUpstream: skill.overridesUpstream,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getRepoRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();

  const body = await req.json();
  const { content } = body as { content: string };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  fs.writeFileSync(resolved.file, content, "utf-8");
  const stat = fs.statSync(resolved.file);
  return NextResponse.json({ ok: true, name, modified: stat.mtimeMs });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getRepoRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.dir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return NextResponse.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim().toLowerCase();
  if (!SKILL_SLUG.test(raw)) {
    return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
  }
  if (raw === name) {
    return NextResponse.json({ ok: true, name });
  }

  const skillsDir = devhubSharedSkillsDir(repoRoot);
  const newDir = path.join(skillsDir, raw);
  if (path.resolve(newDir) !== path.join(path.resolve(skillsDir), raw)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  if (fs.existsSync(newDir)) {
    return NextResponse.json({ error: "Name already taken" }, { status: 409 });
  }

  fs.renameSync(resolved.dir, newDir);
  return NextResponse.json({ ok: true, name: raw });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SKILL_SLUG.test(name)) return invalidSlugResponse();

  const repoRoot = getRepoRoot();
  const { entries } = createSkillCatalogContext(repoRoot);
  const resolved = resolveSkillInCatalog(entries, name);
  if (!resolved || !fs.existsSync(resolved.dir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.readOnly) return readOnlyResponse();

  fs.rmSync(resolved.dir, { recursive: true, force: true });
  return NextResponse.json({ ok: true, name });
}
