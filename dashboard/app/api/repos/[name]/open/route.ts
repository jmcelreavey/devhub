import { parseBody } from "@/lib/api-utils";
import { openPathInCursor } from "@/lib/cursor-open";
import { mergeEntityRefs,parseEntityLinksFromMarkdown,upsertEntityLinksInMarkdown } from "@/lib/entity-note";
import { materializeGitRevisionFile } from "@/lib/git/open-at-revision";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { findWorktree,parseWorktreeList } from "@/lib/repos/worktree-parsers";
import { blocksToText,textToBlocks } from "@/lib/markdown-convert";
import {
applyCursorDraft,
createCursorDraft,
CursorDraftError,
deleteCursorDraft,
getCursorDraft,
} from "@/lib/notes/cursor-draft";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { getVaultStorage } from "@/lib/vault/vault-registry";
import { revalidatePath } from "next/cache";
import { NextRequest,NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

type Params = { params: Promise<{ name: string }> };
const OpenBodySchema = z
  .object({
    notePath: z.string().min(1).optional(),
    /** Repo-relative path to open (working tree or historical revision). */
    filePath: z.string().min(1).optional(),
    /** When set with filePath, open the blob at this commit alongside the repo. */
    commit: z.string().min(1).optional(),
    /**
     * Open one of the repo's worktrees instead of the main checkout, named by
     * absolute path or branch. Agent runs work in a worktree, so the review and
     * the code it describes are only side by side if we open that folder.
     */
    worktree: z.string().min(1).max(4096).optional(),
  })
  .refine((b) => !(b.notePath && b.filePath), {
    message: "Pass notePath or filePath, not both",
  });
const ApplyBodySchema = z.object({ notePath: z.string().min(1) });

export async function GET(req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const notePath = req.nextUrl.searchParams.get("notePath")?.trim();
  if (!notePath) return NextResponse.json({ error: "notePath is required" }, { status: 400 });

  try {
    const storage = getVaultStorage("notes");
    if (!storage.read(notePath)) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    return NextResponse.json({ draft: getCursorDraft(name, notePath, storage.root) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not find Cursor working copy";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveScannedRepo(name);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const parsed = await parseBody(req, OpenBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Everything below resolves against the folder we are actually opening, so a
  // worktree request also reads its files, not the main checkout's copies.
  let openRoot = repoPath;
  if (body.worktree) {
    const list = await runGitRepoAsync(repoPath, ["worktree", "list", "--porcelain"]);
    if (list.status !== 0) {
      return NextResponse.json(
        { error: list.stderr.trim() || "Could not list worktrees" },
        { status: 500 },
      );
    }
    const match = findWorktree(parseWorktreeList(list.stdout || ""), body.worktree);
    if (!match) {
      return NextResponse.json(
        { error: `No worktree of ${name} matches "${body.worktree}".` },
        { status: 404 },
      );
    }
    openRoot = match.path;
  }

  const additionalPaths: string[] = [];
  let writable = false;
  let revisionPath: string | null = null;
  let shortHash: string | null = null;

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
  } else if (body.filePath) {
    if (body.commit) {
      const materialized = await materializeGitRevisionFile(openRoot, name, body.commit, body.filePath);
      if ("error" in materialized) {
        return NextResponse.json({ error: materialized.error }, { status: 400 });
      }
      additionalPaths.push(materialized.absolutePath);
      revisionPath = materialized.absolutePath;
      shortHash = materialized.shortHash;
    } else {
      const abs = pathResolveUnderRepo(openRoot, body.filePath);
      if (!abs) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      additionalPaths.push(abs);
    }
  }

  const error = openPathInCursor(openRoot, additionalPaths);
  if (error) return NextResponse.json({ error }, { status: 503 });

  return NextResponse.json({
    ok: true,
    path: openRoot,
    writable,
    revisionPath,
    shortHash,
  });
}

/** Resolve a repo-relative path; reject traversal. */
function pathResolveUnderRepo(repoRoot: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("..") || path.isAbsolute(rel)) return null;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
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
    const draftBlocks = applyCursorDraft(name, body.notePath, note.content, storage.root);
    const sourceBlocks = Array.isArray(note.content) ? note.content : [note.content];
    const sourceLinks = parseEntityLinksFromMarkdown(blocksToText(sourceBlocks));
    const draftMarkdown = blocksToText(draftBlocks);
    const blocks = textToBlocks(
      upsertEntityLinksInMarkdown(
        draftMarkdown,
        mergeEntityRefs(sourceLinks, parseEntityLinksFromMarkdown(draftMarkdown)),
      ),
    );
    const result = storage.write(body.notePath, blocks);
    deleteCursorDraft(name, body.notePath, storage.root);
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
