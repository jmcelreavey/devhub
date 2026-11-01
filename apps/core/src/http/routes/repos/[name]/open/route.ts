import { parseBody } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { repoCursorDraftApply, repoCursorDraftBodyInput, repoCursorDraftDelete, repoCursorDraftStatus, repoCursorOpen, repoOpen, repoOpenBodyInput, repoOpenOptions } from "../../../../../../../../packages/shared/actions/repos";
import { openPathInCursor } from "../../../../../lib/editor/cursor-open";
import { mergeEntityRefs,parseEntityLinksFromMarkdown,upsertEntityLinksInMarkdown } from "../../../../../../../../packages/shared/ui-lib/entity-note";
import { materializeGitRevisionFile } from "../../../../../lib/git/open-at-revision";
import { runGitRepoAsync } from "../../../../../lib/git/repo-local";
import { findWorktree,parseWorktreeList } from "../../../../../../../../packages/shared/ui-lib/repos/worktree-parsers";
import { blocksToText,textToBlocks } from "../../../../../../../../packages/shared/ui-lib/markdown-convert";
import {
applyCursorDraft,
createCursorDraft,
CursorDraftError,
deleteCursorDraft,
getCursorDraft,
} from "../../../../../lib/notes/cursor-draft";
import { resolveScannedRepo } from "../../../../../lib/repos/scanned-repo";
import { getVaultStorage } from "../../../../../lib/vault/vault-registry";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

type Params = { params: Promise<{ name: string }> };

export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) return Response.json({ error: "Repo not found" }, { status: 404 });

  const notePath = new URL(req.url).searchParams.get("notePath")?.trim();
  if (!notePath) return Response.json({ error: "notePath is required" }, { status: 400 });

  return httpAction(repoCursorDraftStatus, {
    input: () => ({ repoName: name, path: notePath }),
    context: () => ({ read: async (repo, note) => {
      const response = await readCursorDraft(repo, note);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readCursorDraft(name: string, notePath: string) {
  try {
    const storage = getVaultStorage("notes");
    if (!storage.read(notePath)) return Response.json({ error: "Note not found" }, { status: 404 });
    return Response.json({ draft: getCursorDraft(name, notePath, storage.root) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not find Cursor working copy";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveScannedRepo(name);
  if (!repoPath) return Response.json({ error: "Repo not found" }, { status: 404 });

  const parsed = await parseBody(req, repoOpenBodyInput);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const open = async () => {
    const response = await openRepo(name, repoPath, body);
    return { status: response.status, body: await response.json() };
  };
  if (!Object.keys(body).length) {
    return httpAction(repoOpen, {
      input: () => ({ name }),
      context: () => ({ open }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  if (body.notePath) {
    return httpAction(repoCursorOpen, {
      input: () => ({ repoName: name, path: body.notePath, worktree: body.worktree }),
      context: () => ({ open }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  return httpAction(repoOpenOptions, {
    input: () => ({ name, ...body }),
    context: () => ({ open }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}

async function openRepo(name: string, repoPath: string, body: z.output<typeof repoOpenBodyInput>) {
  // Everything below resolves against the folder we are actually opening, so a
  // worktree request also reads its files, not the main checkout's copies.
  let openRoot = repoPath;
  if (body.worktree) {
    const list = await runGitRepoAsync(repoPath, ["worktree", "list", "--porcelain"]);
    if (list.status !== 0) {
      return Response.json(
        { error: list.stderr.trim() || "Could not list worktrees" },
        { status: 500 },
      );
    }
    const match = findWorktree(parseWorktreeList(list.stdout || ""), body.worktree);
    if (!match) {
      return Response.json(
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
      if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
      const draft = createCursorDraft(name, body.notePath, note.content, storage.root);
      additionalPaths.push(draft.markdownPath);
      writable = draft.writable;
    } catch (error) {
      const status = error instanceof CursorDraftError ? error.status : 400;
      const message = error instanceof Error ? error.message : "Invalid note path";
      return Response.json({ error: message }, { status });
    }
  } else if (body.filePath) {
    if (body.commit) {
      const materialized = await materializeGitRevisionFile(openRoot, name, body.commit, body.filePath);
      if ("error" in materialized) {
        return Response.json({ error: materialized.error }, { status: 400 });
      }
      additionalPaths.push(materialized.absolutePath);
      revisionPath = materialized.absolutePath;
      shortHash = materialized.shortHash;
    } else {
      const abs = pathResolveUnderRepo(openRoot, body.filePath);
      if (!abs) return Response.json({ error: "Invalid path" }, { status: 400 });
      additionalPaths.push(abs);
    }
  }

  const error = await openPathInCursor(openRoot, additionalPaths);
  if (error) return Response.json({ error }, { status: 503 });

  return Response.json({
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

export async function PATCH(req: Request, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) {
    return Response.json({ error: "Repo not found" }, { status: 404 });
  }

  const parsed = await parseBody(req, repoCursorDraftBodyInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(repoCursorDraftApply, {
    input: () => ({ repoName: name, path: parsed.data.notePath }),
    context: () => ({ apply: async (repo, note) => {
      const response = await applyDraft(repo, note);
      return { status: response.status, body: await response.json() };
    } }),
    response: ({ response }) => Response.json(response.body, { status: response.status }),
  })(req);
}

async function applyDraft(name: string, notePath: string) {
  try {
    const storage = getVaultStorage("notes");
    const note = storage.read(notePath);
    if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
    const draftBlocks = applyCursorDraft(name, notePath, note.content, storage.root);
    const sourceBlocks = Array.isArray(note.content) ? note.content : [note.content];
    const sourceLinks = parseEntityLinksFromMarkdown(blocksToText(sourceBlocks));
    const draftMarkdown = blocksToText(draftBlocks);
    const blocks = textToBlocks(
      upsertEntityLinksInMarkdown(
        draftMarkdown,
        mergeEntityRefs(sourceLinks, parseEntityLinksFromMarkdown(draftMarkdown)),
      ),
    );
    const result = await storage.writeContent(notePath, blocks, note.revision!);
    deleteCursorDraft(name, notePath, storage.root);
    emitCoreEvent("notes");
    return Response.json(result);
  } catch (error) {
    const status = error instanceof CursorDraftError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not apply Cursor changes";
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { name } = await params;
  if (!resolveScannedRepo(name)) {
    return Response.json({ error: "Repo not found" }, { status: 404 });
  }

  const parsed = await parseBody(req, repoCursorDraftBodyInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(repoCursorDraftDelete, {
    input: () => ({ repoName: name, path: parsed.data.notePath }),
    context: () => ({ remove: async (repo, note) => {
      const response = await removeDraft(repo, note);
      return { status: response.status, body: await response.json() };
    } }),
    response: ({ response }) => Response.json(response.body, { status: response.status }),
  })(req);
}

async function removeDraft(name: string, notePath: string) {
  const storage = getVaultStorage("notes");
  const deleted = deleteCursorDraft(name, notePath, storage.root);
  if (!deleted) return Response.json({ error: "Working copy not found" }, { status: 404 });
  return Response.json({ ok: true });
}
