"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OneTimeShareButton } from "@/components/OneTimeShareButton";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { buildVaultFileMenuGroups } from "@/components/vault/vaultRowMenus";
import { useToast } from "@/lib/hooks/use-toast";
import { getVaultClient } from "@/lib/vault/vault-client";
import {
  copyVaultLocation,
  copyVaultMarkdown,
  duplicateVaultFile,
  shareVaultGist,
} from "@/lib/vault/vault-file-actions";

export interface DocRowTarget {
  slug: string;
  title: string;
  href: string;
}

export function DocRow({
  doc,
  className,
  children,
}: {
  doc: DocRowTarget;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const menu = useContextMenu<"row">();
  const [deleting, setDeleting] = useState(false);
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const vault = getVaultClient("docs");

  const groups = buildVaultFileMenuGroups({
    itemLabel: "doc",
    kind: "docs",
    deleting,
    onOpen: () => router.push(doc.href),
    cursorDisabledReason: "Open in Cursor is for notes linked to a repo.",
    onCopyLocation: () => {
      void copyVaultLocation(doc.slug).then(
        () => toast.success("Location copied"),
        () => toast.error("Could not copy to clipboard."),
      );
    },
    onCopyMarkdown: () => {
      void copyVaultMarkdown("docs", doc.slug).then(
        () => toast.success("Markdown copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
      );
    },
    onShare: () => {
      void shareVaultGist("docs", doc.slug).then(
        () => toast.success("Live — link copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not publish."),
      );
    },
    onOneTime: () => setOneTimeOpen(true),
    onRename: () => {
      void (async () => {
        const name = await prompt({
          title: "Rename doc",
          confirmLabel: "Rename",
          input: { defaultValue: doc.slug.split("/").pop() ?? doc.slug },
        });
        const trimmed = name?.trim();
        if (!trimmed) return;
        try {
          const newSlug = await vault.paths.renameFile(doc.slug, trimmed);
          toast.success("Renamed.");
          router.push(vault.paths.pageHref(newSlug));
          router.refresh();
        } catch (err) {
          if (err instanceof Error && err.message === "unchanged") return;
          toast.error(err instanceof Error ? err.message : "Could not rename.");
        }
      })();
    },
    onDuplicate: () => {
      void duplicateVaultFile("docs", doc.slug).then(
        (next) => {
          toast.success("Duplicated.");
          router.push(vault.paths.pageHref(next));
          router.refresh();
        },
        (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate."),
      );
    },
    onDelete: () => {
      void (async () => {
        const ok = await confirm({
          title: "Delete doc",
          message: `Delete "${doc.title}"? This cannot be undone.`,
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        setDeleting(true);
        try {
          const res = await fetch(`${vault.apiPrefix}/${vault.paths.apiPathFromSlug(doc.slug)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? res.statusText);
          }
          vault.paths.notifyTreeChanged();
          toast.success("Doc deleted.");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not delete doc.");
        } finally {
          setDeleting(false);
        }
      })();
    },
  });

  return (
    <div className={`group ${className ?? ""}`.trim()} {...menu.bindRow("row")}>
      {children}
      <RowMenuKebab
        label={`Actions for ${doc.title}`}
        onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
      />
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${doc.title} actions`}
      />
      <OneTimeShareButton
        vaultId="docs"
        path={doc.slug}
        hideTrigger
        open={oneTimeOpen}
        onOpenChange={setOneTimeOpen}
      />
    </div>
  );
}

/** Nested links must not steal the row menu. */
export function DocRowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onContextMenu={(event) => event.preventDefault()}>
      {children}
    </Link>
  );
}
