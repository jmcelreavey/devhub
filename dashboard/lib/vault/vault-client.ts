import type { VaultId, VaultPublicConfig } from "@/lib/vault/vault-public";
import { VAULT_PUBLIC } from "@/lib/vault/vault-public";

export type { VaultId };

export type VaultClientConfig = VaultPublicConfig;

export function getVaultClient(id: VaultId): VaultClientConfig {
  return VAULT_PUBLIC[id];
}
