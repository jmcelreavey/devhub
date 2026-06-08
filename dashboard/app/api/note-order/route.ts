import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { NoteOrderPatchSchema, formatZodError } from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";
import { getVault, getVaultStorage, parseVaultId } from "@/lib/vault/vault-registry";
import { reorderOrderedVaultEntries } from "@/lib/vault/vault-order";

export const PATCH = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  const vaultId = parseVaultId(url.searchParams.get("vault"));
  const vault = getVault(vaultId);
  const body = await req.json().catch(() => ({}));
  const parsed = NoteOrderPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const entries = getVaultStorage(vaultId).list();
  const ok = await reorderOrderedVaultEntries(entries, vault.getRoot(), parsed.data.paths);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  for (const p of vault.revalidatePaths) {
    revalidatePath(p);
  }
  return NextResponse.json({ ok: true });
}, "note-order.patch");
