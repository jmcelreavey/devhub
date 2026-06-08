export {
  createVaultPathHelpers,
  type VaultPathConfig,
  type VaultPathHelpers,
} from "../../../shared/vault/vault-path.ts";

import type { VaultPathHelpers } from "../../../shared/vault/vault-path.ts";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

export function extendVaultPathHelpers(
  helpers: VaultPathHelpers,
  config: { apiPrefix: string },
): VaultPathHelpers & {
  notifyTreeChanged: () => void;
  renameFile: (currentSlug: string, newBaseName: string) => Promise<string>;
} {
  function notifyTreeChanged(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(helpers.treeRefreshEvent));
    }
  }

  async function renameFile(currentSlug: string, newBaseName: string): Promise<string> {
    const trimmed = newBaseName.trim();
    const current = helpers.normalizeSlug(currentSlug);
    if (!trimmed) {
      throw new Error("Name is required");
    }
    const newSlug = helpers.normalizeSlug(helpers.buildRenamedPath(current, trimmed));
    if (newSlug === current) {
      throw new Error("unchanged");
    }

    broadcastNoteAutosaveInvalidation(current);

    const res = await fetch(`${config.apiPrefix}/${helpers.apiPathFromSlug(current)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: newSlug }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Could not rename file");
    }
    notifyTreeChanged();
    return newSlug;
  }

  return {
    ...helpers,
    notifyTreeChanged,
    renameFile,
  };
}
