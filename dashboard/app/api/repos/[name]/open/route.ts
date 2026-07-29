import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { openPathInCursor } from "@/lib/cursor-open";
import {
  applyCursorDraft,
  createCursorDraft,
  CursorDraftError,
  deleteCursorDraft,
  markCursorDraftApplied,
} from "@/lib/notes/cursor-draft";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { getVaultStorage } from "@/lib/vault/vault-registry";

type Params = { params: Promise<{ name: string }> };
const OpenBodySchema = z.object({ notePath: z.string().min(1).optional() });
const ApplyBodySchema = z.object({ notePath: z.string().min(1) });

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveScannedRepo(name);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const parsed = await parseBody(req, OpenBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const additionalPaths: string[] = [];
  let writable = false;
  if (body.notePath) {
    try {
      const storage = getVaultStorage("notes");
      const note = storage.read(body.notePath);
      if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
      const draft = createCursorDraft(name, body.notePath, note.content, storage.root);
      additionalPaths.push(draft.markdownPath);
      writable = draft.writable;
    } catch (error) {
      const status = error instanceof CursorDraftError ? error.status : 400;
      const message = error instanceof Error ? error.message : "Invalid note path";
      return NextResponse.json({ error: message }, { status });
    }
  }

  const error = openPathInCursor(repoPath, additionalPaths);
  if (error) return NextResponse.json({ error }, { status: 503 });

  return NextResponse.json({ ok: true, path: repoPath, writable });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const parsed = await parseBody(req, ApplyBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const storage = getVaultStorage("notes");
    const note = storage.read(body.notePath);
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    const blocks = applyCursorDraft(name, body.notePath, note.content, storage.root);
    const result = storage.write(body.notePath, blocks);
    markCursorDraftApplied(name, body.notePath, result.content, storage.root);
    revalidatePath("/notes");
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof CursorDraftError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not apply Cursor changes";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const parsed = await parseBody(req, ApplyBodySchema);
  if (!parsed.ok) return parsed.response;

  const storage = getVaultStorage("notes");
  const deleted = deleteCursorDraft(name, parsed.data.notePath, storage.root);
  if (!deleted) return NextResponse.json({ error: "Working copy not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
