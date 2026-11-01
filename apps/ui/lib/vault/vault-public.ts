import { VAULT_PUBLIC as sharedVaults, type VaultId, type VaultPublicConfig as SharedVaultConfig } from "@shared/vault/public.ts";
import { extendVaultPathHelpers } from "@/lib/vault/vault-path";

export { parseVaultId } from "@shared/vault/public.ts";
export type { VaultId } from "@shared/vault/public.ts";

export interface VaultPublicConfig extends Omit<SharedVaultConfig, "paths"> {
  paths: ReturnType<typeof extendVaultPathHelpers>;
}

export const VAULT_PUBLIC: Record<VaultId, VaultPublicConfig> = {
  notes: { ...sharedVaults.notes, paths: extendVaultPathHelpers(sharedVaults.notes.paths, { apiPrefix: sharedVaults.notes.apiPrefix }) },
  docs: { ...sharedVaults.docs, paths: extendVaultPathHelpers(sharedVaults.docs.paths, { apiPrefix: sharedVaults.docs.apiPrefix }) },
};
