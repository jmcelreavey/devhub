import { NextRequest, NextResponse } from "next/server";
import { deleteLocalRepo, readRepoInfo } from "@/lib/repos";
import { resolveScannedRepo } from "@/lib/scanned-repo";

type Params = { params: Promise<{ name: string }> };

/**
 * One repo's card data. The repo hub used to fetch `/api/repos` — a `git status`
 * across every clone — just to pick out the one it shows.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveScannedRepo(name);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  try {
    return NextResponse.json({ repo: await readRepoInfo(name, repoPath) });
  } catch (error) {
    console.error("[api:repos:get]", error);
    return NextResponse.json({ error: "Couldn't read repo" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const deleted = deleteLocalRepo(name);
    return NextResponse.json({ ok: true, repo: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Repo not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Invalid") || message.includes("Refusing")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api:repos:delete]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
