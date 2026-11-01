import { sharePublish, shareLiveList, shareLiveRevoke, shareClearLive } from "../../../../../../packages/shared/actions/share";
import { withErrorHandler, parseBody } from "../../../lib/api-utils";
import { ShareCreateSchema } from "../../../lib/schemas";
import { mapGithubCliError } from "../../../lib/gh-exec";
import { parseVaultId } from "../../../lib/vault/vault-registry";
import { createGist, deleteGist, updateGist } from "../../../lib/share/gist";
import { hashMarkdown, listShareStatuses, readShareSource } from "../../../lib/share/share-content";
import {
  clearShares,
  getShare,
  removeShare,
  upsertShare,
} from "../../../lib/share/share-store";
import { shareKey, type ShareRecord } from "../../../../../../packages/shared/ui-lib/share/share-public";

export const GET = withErrorHandler(async () => {
  return Response.json({ shares: await shareLiveList.handler({}, { execute: listShareStatuses }) });
}, "share.get");

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, ShareCreateSchema);
  if (!parsed.ok) return parsed.response;
  return await sharePublish.handler({ ...parsed.data, vault: parseVaultId(parsed.data.vault) }, { execute: async () => {
  const vault = parseVaultId(parsed.data.vault);
  const sharePath = parsed.data.path;
  const source = readShareSource(vault, sharePath);
  if (!source) {
    return Response.json({ error: "Note not found" }, { status: 404 });
  }
  const { title, markdown } = source;
  if (!markdown.trim()) {
    return Response.json({ error: "Nothing to share — the note is empty" }, { status: 400 });
  }
  const contentHash = hashMarkdown(markdown);

  try {
    const existing = getShare(vault, sharePath);
    const now = Date.now();
    if (existing) {
      await updateGist(existing.gistId, title, markdown);
      const record: ShareRecord = { ...existing, title, updatedAt: now, contentHash };
      return Response.json({ share: await upsertShare(record) });
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
    return Response.json({ share: await upsertShare(record) });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to publish gist");
    return Response.json({ error }, { status });
  }
  } }) as Response;
}, "share.post");

export const DELETE = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("all") === "1") {
      const removed = await shareClearLive.handler({}, { execute: clearShares }) as Awaited<ReturnType<typeof clearShares>>;
      await Promise.allSettled(removed.map((s) => deleteGist(s.gistId)));
      return Response.json({ ok: true, removed: removed.length });
    }
    const parsed = await parseBody(req, ShareCreateSchema);
    if (!parsed.ok) return parsed.response;
    const vault = parseVaultId(parsed.data.vault);
    const removed = await shareLiveRevoke.handler({ vault, path: parsed.data.path }, { execute: ({ vault, path }) => removeShare(vault, path) }) as Awaited<ReturnType<typeof removeShare>>;
    if (!removed) {
      return Response.json({ error: "Not shared" }, { status: 404 });
    }
    await deleteGist(removed.gistId);
    return Response.json({ ok: true });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to remove share");
    return Response.json({ error }, { status });
  }
}, "share.delete");
