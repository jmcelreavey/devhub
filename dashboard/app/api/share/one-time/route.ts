import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { OneTimeShareCreateSchema, OneTimeShareDeleteSchema } from "@/lib/schemas";
import { parseVaultId } from "@/lib/vault/vault-registry";
import { createPaste, deletePaste } from "@/lib/share/privatebin/client";
import { PASTE_EXPIRY_MS } from "@/lib/share/privatebin/crypto";
import { generatePassphrase } from "@/lib/share/passphrase";
import { readShareSource } from "@/lib/share/share-content";
import {
  addOneTimeShare,
  clearOneTimeShares,
  listOneTimeShares,
  removeOneTimeShare,
} from "@/lib/share/share-store";
import type { OneTimeRecord } from "@/lib/share/share-public";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ shares: listOneTimeShares() }, { headers: NO_STORE });
}, "share.one-time.get");

function gitSharePath(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `git-share/${slug || "diff"}`;
}

/**
 * Publish a note as a burn-after-reading link.
 *
 * Unlike `/api/share`, this never updates in place: the paste is consumed on
 * first read, so "re-share" means a genuinely new link. Publishing the same
 * note twice deliberately produces two independent links rather than replacing
 * the first — the first may already be in someone's inbox.
 *
 * Also accepts raw markdown (git patches) so History can share a range without
 * writing a vault note first.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, OneTimeShareCreateSchema);
  if (!parsed.ok) return parsed.response;

  let title: string;
  let markdown: string;
  let vault: ReturnType<typeof parseVaultId>;
  let sharePath: string;

  if ("markdown" in parsed.data) {
    title = parsed.data.title;
    markdown = parsed.data.markdown;
    vault = parseVaultId("notes");
    sharePath = gitSharePath(title);
  } else {
    vault = parseVaultId(parsed.data.vault);
    sharePath = parsed.data.path;
    const source = readShareSource(vault, sharePath);
    if (!source) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    title = source.title;
    markdown = source.markdown;
  }
  if (!markdown.trim()) {
    return NextResponse.json({ error: "Nothing to share — the note is empty" }, { status: 400 });
  }

  const expire = parsed.data.expire;
  const passphrase = parsed.data.password ? generatePassphrase() : "";

  try {
    const paste = await createPaste(markdown, {
      password: passphrase,
      expire,
      burnAfterReading: true,
      formatter: "markdown",
    });

    const now = Date.now();
    const record: OneTimeRecord = {
      id: crypto.randomUUID(),
      vault,
      path: sharePath,
      title,
      url: paste.url,
      pasteId: paste.pasteId,
      deleteToken: paste.deleteToken,
      hasPassword: passphrase.length > 0,
      burnAfterReading: true,
      expire,
      createdAt: now,
      expiresAt: now + PASTE_EXPIRY_MS[expire],
    };
    await addOneTimeShare(record);

    // The passphrase is returned exactly once and never persisted. If the user
    // loses it the link is dead — which is the correct trade against keeping a
    // plaintext password next to the URL it unlocks.
    return NextResponse.json({ share: record, passphrase }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create one-time link";
    // Instance unreachable / rejected is a dependency failure, not a bad request.
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE });
  }
}, "share.one-time.post");

/**
 * Revoke a link. Only works before the recipient reads it — afterwards the
 * paste is already gone and this just tidies the local registry, which is why
 * a failed revoke still drops the record.
 */
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const url = new URL(req.url);

  if (url.searchParams.get("all") === "1") {
    const removed = await clearOneTimeShares();
    await Promise.allSettled(removed.map((r) => deletePaste(r.pasteId, r.deleteToken)));
    return NextResponse.json({ ok: true, removed: removed.length }, { headers: NO_STORE });
  }

  const parsed = await parseBody(req, OneTimeShareDeleteSchema);
  if (!parsed.ok) return parsed.response;

  const removed = await removeOneTimeShare(parsed.data.id);
  if (!removed) {
    return NextResponse.json({ error: "No such one-time link" }, { status: 404 });
  }
  try {
    await deletePaste(removed.pasteId, removed.deleteToken);
  } catch (err) {
    console.error("[share.one-time.delete] revoke failed, record dropped anyway", err);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}, "share.one-time.delete");
