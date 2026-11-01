import { getDocsDir, getNotesDir } from "../content/dirs";
import { NotesStorage } from "../../domains/storage/notes";
import { jsonVaultCodec, markdownVaultCodec } from "./vault-codec";
import type { VaultPathHelpers } from "../../../../../packages/shared/vault/vault-path.ts";
import {
  parseVaultId,
  VAULT_PUBLIC,
  type VaultId,
} from "../../../../../packages/shared/vault/public.ts";
import { VaultStorage } from "../../domains/storage/vault";

export type { VaultId };
export { parseVaultId };

export interface VaultDefinition {
  id: VaultId;
  getRoot: () => string;
  codec: typeof jsonVaultCodec | typeof markdownVaultCodec;
  pagePrefix: string;
  apiPrefix: string;
  treeApi: string;
  orderApi: string;
  extension: string;
  treeRefreshEvent: string;
  supportsAssets: boolean;
  supportsTldrawSearch: boolean;
  paths: VaultPathHelpers;
}

export const VAULTS: Record<VaultId, VaultDefinition> = {
  notes: {
    ...VAULT_PUBLIC.notes,
    getRoot: getNotesDir,
    codec: jsonVaultCodec,
  },
  docs: {
    ...VAULT_PUBLIC.docs,
    getRoot: getDocsDir,
    codec: markdownVaultCodec,
  },
};

const storageCache = new Map<VaultId, VaultStorage>();

export function getVaultStorage(id: "notes"): NotesStorage;
export function getVaultStorage(id: "docs"): VaultStorage;
export function getVaultStorage(id: VaultId): VaultStorage;
export function getVaultStorage(id: VaultId): VaultStorage {
  let storage = storageCache.get(id);
  if (!storage) {
    const vault = VAULTS[id];
    storage =
      id === "notes"
        ? new NotesStorage(vault.getRoot())
        : new VaultStorage(vault.getRoot(), vault.codec);
    storageCache.set(id, storage);
  }
  return storage;
}

export function getVault(id: VaultId): VaultDefinition {
  return VAULTS[id];
}
