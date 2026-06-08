import Link from "next/link";
import { VaultIndexPage } from "@/components/VaultIndexPage";
import { getVaultTree } from "@/lib/vault/create-vault-routes";
import { filterNotesSidebarTree } from "@/lib/notes-tree-sidebar-filter";
import { buildVaultIndexSummary } from "@/lib/vault/vault-index-summary";
import { VAULT_PUBLIC } from "@/lib/vault/vault-public";

export default async function NotesIndexPage() {
  const vault = VAULT_PUBLIC.notes;
  const rawTree = await getVaultTree("notes");
  const tree = filterNotesSidebarTree(rawTree);
  const summary = buildVaultIndexSummary(tree, {
    extension: vault.extension,
    pageHref: vault.paths.pageHref,
  });

  return (
    <VaultIndexPage
      vaultId="notes"
      summary={summary}
      footerHint={
        <>
          Or open{" "}
          <Link href="/notes?panel=checklists" style={{ color: "var(--accent)" }}>
            Checklists
          </Link>{" "}
          to manage master lists.
        </>
      }
    />
  );
}
