import { VaultIndexPage } from "@/components/VaultIndexPage";
import { getVaultTree } from "@/lib/vault/create-vault-routes";
import { buildVaultIndexSummary } from "@/lib/vault/vault-index-summary";
import { VAULT_PUBLIC } from "@/lib/vault/vault-public";

export default async function DocsIndexPage() {
  const vault = VAULT_PUBLIC.docs;
  const tree = await getVaultTree("docs");
  const summary = buildVaultIndexSummary(tree, {
    extension: vault.extension,
    pageHref: vault.paths.pageHref,
  });

  return <VaultIndexPage vaultId="docs" summary={summary} />;
}
