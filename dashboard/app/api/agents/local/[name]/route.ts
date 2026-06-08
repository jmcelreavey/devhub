import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { readLocalAgentContent } from "@/lib/local-catalog-content";
import { deleteLocalAgentInstallations } from "@/lib/local-catalog-delete";
import { getRepoRoot } from "@/lib/notes-dir";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  const content = readLocalAgentContent(getRepoRoot(), name);
  if (content === null) {
    return NextResponse.json({ error: "Local agent not found" }, { status: 404 });
  }
  return NextResponse.json({ content });
}, "agents.local.name");

export const DELETE = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  const result = deleteLocalAgentInstallations(getRepoRoot(), name);
  if (!result) {
    return NextResponse.json({ error: "Local agent not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}, "agents.local.name.delete");
