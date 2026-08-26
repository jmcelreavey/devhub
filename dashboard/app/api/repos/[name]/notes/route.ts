import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { loadIndex } from "@/lib/recall/store";
import { resolveScannedRepo } from "@/lib/scanned-repo";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(
  async (_req: Request, { params }: { params: Promise<{ name: string }> }) => {
    const { name } = await params;
    if (!resolveScannedRepo(name)) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const index = loadIndex();
    if (!index) return NextResponse.json({ notes: [] });

    const key = `repo:${name}`;
    const notes = new Map<string, { slug: string; href: string; title: string }>();
    for (const chunk of index.chunks) {
      if (!chunk.refs.includes(key)) continue;
      if (chunk.sourceKind !== "note" && chunk.sourceKind !== "learning") continue;
      if (notes.has(chunk.sourceId)) continue;
      notes.set(chunk.sourceId, {
        slug: chunk.sourceId,
        href: chunk.href ?? `/notes/${chunk.sourceId}`,
        title: chunk.title.split(" — ")[0],
      });
    }

    return NextResponse.json({ notes: [...notes.values()] });
  },
  "repos.notes",
);
