import { noteOrder } from "../../../../../../packages/shared/actions/notes";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import { formatZodError } from "../../../lib/schemas";
import { withErrorHandler } from "../../../lib/api-utils";
import { getVault, getVaultStorage, parseVaultId } from "../../../lib/vault/vault-registry";
import { reorderOrderedVaultEntries } from "../../../lib/vault/vault-order";
import { ContentConflictError } from "../../../../../../packages/shared/storage/content";

export const PATCH = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  const vaultId = parseVaultId(url.searchParams.get("vault"));
  const vault = getVault(vaultId);
  const body = await req.json().catch(() => ({}));
  const parsed = noteOrder.input.omit({ vault: true }).safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  return await noteOrder.handler({ vault: vaultId, paths: parsed.data.paths }, { execute: async ({ paths }) => {
    const entries = getVaultStorage(vaultId).list();
    let ok: boolean;
    try {
      ok = await reorderOrderedVaultEntries(entries, vault.getRoot(), paths);
    } catch (error) {
      if (error instanceof ContentConflictError) return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    emitCoreEvent(vaultId === "docs" ? "recall" : "notes");
    return Response.json({ ok: true });
  } }) as Response;
}, "note-order.patch");
