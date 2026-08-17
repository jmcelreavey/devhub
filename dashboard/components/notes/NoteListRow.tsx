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
import { toDiagramRoutePath } from "@/lib/diagram-utils";
import { broadcastNoteAutosaveInvalidation } from "@/lib/notes/autosave-invalidation";
import { getVaultClient } from "@/lib/vault/vault-client";
import {
  copyVaultLocation,
  copyVaultMarkdown,
  duplicateVaultFile,
  fileKindForRow,
  openLinkedNoteInCursor,
  shareVaultGist,
} from "@/lib/vault/vault-file-actions";

export interface NoteListRowItem {
  slug: string;
  href: string;
  title: string;
  isDiagram?: boolean;
}

export function NoteListRow({
  note,
  children,
  className,
}: {
  note: NoteListRowItem;
  children: ReactNode;
  className: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const menu = useContextMenu<NoteListRowItem>();
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const vault = getVaultClient("notes");
  const rowKind = fileKindForRow("notes", note.slug, note.href);
  const canShare = rowKind !== "diagrams";
  const itemLabel = rowKind === "diagrams" ? "diagram" : "note";

  const groups = buildVaultFileMenuGroups({
    itemLabel,
    kind: rowKind,
    onOpen: () => router.push(note.href),
    onOpenInCursor:
      rowKind === "notes"
        ? () => {
            void openLinkedNoteInCursor(note.slug, toast).catch((err) => {
              toast.error(err instanceof Error ? err.message : "Could not open in Cursor.");
            });
          }
        : undefined,
    onCopyLocation: () => {
      void copyVaultLocation(note.slug).then(
        () => toast.success("Location copied"),
        () => toast.error("Could not copy to clipboard."),
      );
    },
    onCopyMarkdown: canShare
      ? () => {
          void copyVaultMarkdown("notes", note.slug).then(
            () => toast.success("Markdown copied"),
            (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
          );
        }
      : undefined,
    onShare: canShare
      ? () => {
          void shareVaultGist("notes", note.slug).then(
            () => toast.success("Live — link copied"),
            (err) => toast.error(err instanceof Error ? err.message : "Could not publish."),
          );
        }
      : undefined,
    onOneTime: canShare ? () => setOneTimeOpen(true) : undefined,
    onRename: () => {
      void (async () => {
        const name = await prompt({
          title: `Rename ${itemLabel}`,
          confirmLabel: "Rename",
          input: { defaultValue: note.slug.split("/").pop() ?? note.slug },
        });
        const trimmed = name?.trim();
        if (!trimmed) return;
        try {
          const newSlug = await vault.paths.renameFile(note.slug, trimmed);
          toast.success("Renamed.");
          router.push(rowKind === "diagrams" ? toDiagramRoutePath(newSlug) : vault.paths.pageHref(newSlug));
          router.refresh();
        } catch (err) {
          if (err instanceof Error && err.message === "unchanged") return;
          toast.error(err instanceof Error ? err.message : "Could not rename.");
        }
      })();
    },
    onDuplicate: () => {
      void duplicateVaultFile("notes", note.slug).then(
        (next) => {
          toast.success("Duplicated.");
          router.push(rowKind === "diagrams" ? toDiagramRoutePath(next) : vault.paths.pageHref(next));
          router.refresh();
        },
        (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate."),
      );
    },
    onDelete: () => {
      void (async () => {
        const ok = await confirm({
          title: `Delete ${itemLabel}`,
          message: `Delete "${note.title}"? This cannot be undone.`,
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        broadcastNoteAutosaveInvalidation(note.slug);
        try {
          const res = await fetch(`${vault.apiPrefix}/${vault.paths.apiPathFromSlug(note.slug)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? res.statusText);
          }
          vault.paths.notifyTreeChanged();
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Could not delete ${itemLabel}.`);
        }
      })();
    },
  });

  return (
    <div className="lib-row-menu-host group" {...menu.bindRow(note)}>
      <Link href={note.href} className={className} onContextMenu={(event) => event.preventDefault()}>
        {children}
      </Link>
      <RowMenuKebab
        label={`Actions for ${note.title}`}
        onOpen={(x, y) => menu.openAtPoint(x, y, note)}
      />
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${note.title} actions`}
      />
      {canShare ? (
        <OneTimeShareButton
          vaultId="notes"
          path={note.slug}
          hideTrigger
          open={oneTimeOpen}
          onOpenChange={setOneTimeOpen}
        />
      ) : null}
    </div>
  );
}
