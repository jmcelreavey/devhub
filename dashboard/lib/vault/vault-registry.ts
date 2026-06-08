import { getDocsDir, getNotesDir } from "@/lib/content-dirs";
import { NotesStorage } from "@/lib/storage";
import { jsonVaultCodec, markdownVaultCodec } from "@/lib/vault/vault-codec";
import type { VaultPathHelpers } from "@/lib/vault/vault-path";
import {
  parseVaultId,
  VAULT_PUBLIC,
  type VaultId,
} from "@/lib/vault/vault-public";
import { VaultStorage } from "@/lib/vault/vault-storage";

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
  revalidatePaths: string[];
  supportsAssets: boolean;
  supportsTldrawSearch: boolean;
  paths: VaultPathHelpers;
}

export const VAULTS: Record<VaultId, VaultDefinition> = {
  notes: {
    ...VAULT_PUBLIC.notes,
    getRoot: getNotesDir,
    codec: jsonVaultCodec,
    revalidatePaths: ["/notes", "/diagrams"],
  },
  docs: {
    ...VAULT_PUBLIC.docs,
    getRoot: getDocsDir,
    codec: markdownVaultCodec,
    revalidatePaths: ["/docs"],
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
