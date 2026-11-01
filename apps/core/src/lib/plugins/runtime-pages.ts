import { ContentConflictError } from "../../../../../packages/shared/storage/content";
import { getVaultStorage } from "../vault/vault-registry";
import { textToBlocks } from "../../../../../packages/shared/ui-lib/markdown-convert";
import { PluginApiError, type PluginContext } from "./context";
import { loadRuntime } from "./runtime-host";
import { allowsPageAction, pageActionRequestSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-page-contract";

/** Recheck the reviewed snapshot at the authority boundary, including after a host confirmation. */
export function authorizePageAction(ctx: PluginContext, name: string, input: unknown) {
  const parsed = pageActionRequestSchema.safeParse(input);
  if (!parsed.success) throw new PluginApiError(400, "PAGE_ACTION", "Invalid page action.");
  const plugin = loadRuntime(ctx, name);
  if (parsed.data.revision !== plugin.revision) throw new PluginApiError(409, "PAGE_CHANGED", "This plugin changed. Reload its page before continuing.");
  const page = plugin.runtime.pages.find(page => page.path === parsed.data.page);
  if (!page || !allowsPageAction(page.browser, parsed.data.action)) throw new PluginApiError(403, "PAGE_DENIED", "This browser action was not reviewed for this page.");
  return { page, action: parsed.data.action };
}

export async function createPageNote(ctx: PluginContext, name: string, input: unknown) {
  const { page, action } = authorizePageAction(ctx, name, input);
  if (action.kind !== "createNote" || !page.browser?.createNote) throw new PluginApiError(400, "PAGE_ACTION", "Expected a create-only note action.");
  const relative = `${page.browser.createNote}/${new Date().toISOString().slice(0, 10)}`;
  const storage = getVaultStorage("notes");
  if (storage.read(relative)) throw new PluginApiError(409, "NOTE_EXISTS", "Today's note already exists. Open it in Notes; your existing note has been kept.");
  try {
    await storage.writeContent(relative, textToBlocks(action.markdown), null);
  } catch (error) {
    if (error instanceof ContentConflictError) throw new PluginApiError(409, "NOTE_EXISTS", "Today's note already exists. Open it in Notes; your existing note has been kept.");
    throw error;
  }
  return { href: `/notes/${relative}` };
}
