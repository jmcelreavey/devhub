import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { mapGithubCliError } from "@/lib/gh-exec";
import { parseVaultId } from "@/lib/vault/vault-registry";
import { createGist, deleteGist, updateGist } from "@/lib/share/gist";
import { hashMarkdown, listShareStatuses, readShareSource } from "@/lib/share/share-content";
import {
  clearShares,
  getShare,
  removeShare,
  upsertShare,
} from "@/lib/share/share-store";
import { shareKey, type ShareRecord } from "@/lib/share/share-public";

const BodySchema = z.object({
  vault: z.string(),
  path: z.string().min(1),
});

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ shares: listShareStatuses() });
}, "share.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = BodySchema.safeParse(await parseBody(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "vault and path are required" }, { status: 400 });
  }
  const vault = parseVaultId(parsed.data.vault);
  const sharePath = parsed.data.path;
  const source = readShareSource(vault, sharePath);
  if (!source) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  const { title, markdown } = source;
  if (!markdown.trim()) {
    return NextResponse.json({ error: "Nothing to share — the note is empty" }, { status: 400 });
  }
  const contentHash = hashMarkdown(markdown);

  try {
    const existing = getShare(vault, sharePath);
    const now = Date.now();
    if (existing) {
      await updateGist(existing.gistId, title, markdown);
      const record: ShareRecord = { ...existing, title, updatedAt: now, contentHash };
      return NextResponse.json({ share: await upsertShare(record) });
    }
    const { gistId, url } = await createGist(title, markdown);
    const record: ShareRecord = {
      key: shareKey(vault, sharePath),
      vault,
      path: sharePath,
      title,
      gistId,
      url,
      createdAt: now,
      updatedAt: now,
      contentHash,
    };
    return NextResponse.json({ share: await upsertShare(record) });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to publish gist");
    return NextResponse.json({ error }, { status });
  }
}, "share.post");

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("all") === "1") {
      const removed = await clearShares();
      await Promise.allSettled(removed.map((s) => deleteGist(s.gistId)));
      return NextResponse.json({ ok: true, removed: removed.length });
    }
    const parsed = BodySchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return NextResponse.json({ error: "vault and path are required" }, { status: 400 });
    }
    const vault = parseVaultId(parsed.data.vault);
    const removed = await removeShare(vault, parsed.data.path);
    if (!removed) {
      return NextResponse.json({ error: "Not shared" }, { status: 404 });
    }
    await deleteGist(removed.gistId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to remove share");
    return NextResponse.json({ error }, { status });
  }
}, "share.delete");
