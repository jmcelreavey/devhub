import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { listLearningEntries, readLearningDetail } from "@/lib/learnings-index";

export const dynamic = "force-dynamic";

function learningsDir(): string {
  return path.join(getRepoRoot(), "notes", "learnings");
}

export function GET(req: NextRequest) {
  const dir = learningsDir();
  const category = req.nextUrl.searchParams.get("category");

  if (category) {
    const detail = readLearningDetail(dir, category);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail);
  }

  return NextResponse.json({ entries: listLearningEntries(dir) });
}
