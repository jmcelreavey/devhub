import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { readLocalSkillContent } from "@/lib/local/catalog-content";
import { deleteLocalSkillInstallations } from "@/lib/local/catalog-delete";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  const content = readLocalSkillContent(getResourceRoot(), name);
  if (content === null) {
    return NextResponse.json({ error: "Local skill not found" }, { status: 404 });
  }
  return NextResponse.json({ content });
}, "skills.local.name");

export const DELETE = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  const result = deleteLocalSkillInstallations(getResourceRoot(), name);
  if (!result) {
    return NextResponse.json({ error: "Local skill not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}, "skills.local.name.delete");
