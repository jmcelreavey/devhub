/**
 * Client-safe vault metadata (no node:fs). Used by UI and vault-client.
 */
import { createVaultPathHelpers } from "@/lib/vault/vault-path";
import { extendVaultPathHelpers } from "@/lib/vault/vault-path";

export type VaultId = "notes" | "docs";

export interface VaultPublicConfig {
  id: VaultId;
  pagePrefix: string;
  apiPrefix: string;
  treeApi: string;
  orderApi: string;
  extension: string;
  treeRefreshEvent: string;
  newItemEvent: string;
  itemLabel: string;
  itemLabelPlural: string;
  paths: ReturnType<typeof extendVaultPathHelpers>;
  supportsAssets: boolean;
  supportsTldrawSearch: boolean;
}

const notesPaths = extendVaultPathHelpers(
  createVaultPathHelpers({
    pagePrefix: "/notes",
    apiPrefix: "/api/notes",
    extension: ".json",
    treeRefreshEvent: "devhub:notes-tree-changed",
  }),
  { apiPrefix: "/api/notes" },
);

const docsPaths = extendVaultPathHelpers(
  createVaultPathHelpers({
    pagePrefix: "/docs",
    apiPrefix: "/api/docs",
    extension: ".md",
    treeRefreshEvent: "devhub:docs-tree-changed",
  }),
  { apiPrefix: "/api/docs" },
);

export const VAULT_PUBLIC: Record<VaultId, VaultPublicConfig> = {
  notes: {
    id: "notes",
    pagePrefix: "/notes",
    apiPrefix: "/api/notes",
    treeApi: "/api/tree",
    orderApi: "/api/note-order",
    extension: ".json",
    treeRefreshEvent: notesPaths.treeRefreshEvent,
    newItemEvent: "devhub:new-note",
    itemLabel: "note",
    itemLabelPlural: "notes",
    paths: notesPaths,
    supportsAssets: true,
    supportsTldrawSearch: true,
  },
  docs: {
    id: "docs",
    pagePrefix: "/docs",
    apiPrefix: "/api/docs",
    treeApi: "/api/docs/tree",
    orderApi: "/api/note-order?vault=docs",
    extension: ".md",
    treeRefreshEvent: docsPaths.treeRefreshEvent,
    newItemEvent: "devhub:new-doc",
    itemLabel: "doc",
    itemLabelPlural: "docs",
    paths: docsPaths,
    supportsAssets: false,
    supportsTldrawSearch: false,
  },
};

export function parseVaultId(raw: string | null | undefined): VaultId {
  if (raw === "docs") return "docs";
  return "notes";
}
