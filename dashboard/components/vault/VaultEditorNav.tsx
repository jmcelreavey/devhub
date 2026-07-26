"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { ArrowLeft, List } from "lucide-react";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import {
  recordVaultNavigation,
  resolveVaultBackTarget,
} from "@/lib/vault/vault-back-navigation";

export function VaultEditorNav({ vaultId }: { vaultId: VaultId }) {
  const vault = getVaultClient(vaultId);
  const pathname = usePathname();
  const router = useRouter();
  const indexHref = vault.pagePrefix;
  const indexLabel = vaultId === "docs" ? "Docs index" : "Notes index";

  useEffect(() => {
    recordVaultNavigation(vaultId, vault.pagePrefix, pathname);
  }, [vaultId, vault.pagePrefix, pathname]);

  const handleBack = useCallback(() => {
    const target = resolveVaultBackTarget(vaultId, vault.pagePrefix, pathname);
    if (target) {
      router.push(target);
      return;
    }
    router.push(indexHref);
  }, [vaultId, vault.pagePrefix, pathname, router, indexHref]);

  return (
    <div className="flex items-center gap-1 shrink-0 mb-2">
      <button
        type="button"
        onClick={handleBack}
        className="btn btn-ghost text-xs flex items-center gap-1 px-2 py-1"
        aria-label={`Back within ${vault.itemLabelPlural}`}
      >
        <ArrowLeft size={14} aria-hidden />
        <span className="hidden sm:inline">Back</span>
      </button>
      <Link
        href={indexHref}
        className="btn btn-ghost text-xs flex items-center gap-1 px-2 py-1 no-underline"
        aria-label={indexLabel}
      >
        <List size={14} aria-hidden />
        <span className="hidden sm:inline">Index</span>
      </Link>
    </div>
  );
}
