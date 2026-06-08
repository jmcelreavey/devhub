import { createVaultPathHelpers } from "./vault-path.ts";

export type VaultId = "notes" | "docs";

const notesPaths = createVaultPathHelpers({
  pagePrefix: "/notes",
  apiPrefix: "/api/notes",
  extension: ".json",
  treeRefreshEvent: "devhub:notes-tree-changed",
});

const docsPaths = createVaultPathHelpers({
  pagePrefix: "/docs",
  apiPrefix: "/api/docs",
  extension: ".md",
  treeRefreshEvent: "devhub:docs-tree-changed",
});

/** Client-safe vault route helpers (no node:fs). */
export const VAULT_PATHS: Record<VaultId, ReturnType<typeof createVaultPathHelpers>> = {
  notes: notesPaths,
  docs: docsPaths,
};
