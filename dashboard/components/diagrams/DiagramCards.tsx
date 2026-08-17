"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder } from "lucide-react";
import { InlineNoteRename } from "@/components/InlineNoteRename";
import { OneTimeShareButton } from "@/components/OneTimeShareButton";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import {
  buildVaultFileMenuGroups,
  buildVaultFolderMenuGroups,
} from "@/components/vault/vaultRowMenus";
import {
  createDiagramFolder,
  createDiagramInFolder,
  deleteDiagramFolder,
  renameDiagramFolder,
} from "@/lib/diagram-folder-actions";
import {
  toDiagramRoutePath,
  toNotesApiPath,
  type DiagramFile,
  type DiagramFolder,
} from "@/lib/diagram-utils";
import { useToast } from "@/lib/hooks/use-toast";
import { broadcastNoteAutosaveInvalidation } from "@/lib/notes/autosave-invalidation";
import { renameNoteFile } from "@/lib/notes/path";
import {
  copyVaultLocation,
  copyVaultMarkdown,
  duplicateVaultFile,
  shareVaultGist,
} from "@/lib/vault/vault-file-actions";

export function DiagramFolderCard({
  folder,
  onOpen,
  onChanged,
  onMove,
}: {
  folder: DiagramFolder;
  onOpen: () => void;
  onChanged: () => void;
  onMove: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const menu = useContextMenu<"row">();
  const [deleting, setDeleting] = useState(false);
  const [editRequest, setEditRequest] = useState(0);

  const groups = buildVaultFolderMenuGroups({
    itemLabel: "diagram",
    deleting,
    onNewItem: () => {
      void createDiagramInFolder(folder.relPath)
        .then((path) => {
          toast.success("Diagram created.");
          onChanged();
          router.push(toDiagramRoutePath(path));
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : "Could not create diagram."));
    },
    onNewFolder: () => {
      void (async () => {
        const name = await prompt({
          title: "New folder",
          message: `Create a folder inside "${folder.name}".`,
          confirmLabel: "Create",
          input: { placeholder: "folder-name" },
        });
        const trimmed = name?.trim();
        if (!trimmed) return;
        try {
          await createDiagramFolder(folder.relPath, trimmed);
          toast.success("Folder created.");
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not create folder.");
        }
      })();
    },
    onCopyPath: () => {
      void copyVaultLocation(folder.storagePath).then(
        () => toast.success("Location copied"),
        () => toast.error("Could not copy to clipboard."),
      );
    },
    onRename: () => setEditRequest((n) => n + 1),
    onMove,
    onDelete: () => {
      void (async () => {
        const ok = await confirm({
          title: "Delete folder",
          message: `Delete folder "${folder.name}" and every diagram inside it? This cannot be undone.`,
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        setDeleting(true);
        try {
          await deleteDiagramFolder(folder.storagePath);
          toast.success("Folder deleted.");
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't delete folder.");
        } finally {
          setDeleting(false);
        }
      })();
    },
  });

  return (
    <div className="card p-3 flex flex-col gap-2 group" {...menu.bindRow("row")}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full aspect-square rounded flex items-center justify-center"
        style={{ background: "var(--bg)" }}
        title={`Open ${folder.name}`}
        aria-label={`Open folder ${folder.name}`}
      >
        <Folder size={36} className="text-text-subtle" aria-hidden />
      </button>
      <div className="flex items-center gap-1">
        <InlineNoteRename
          noteSlug={folder.storagePath}
          displayName={folder.name}
          active={false}
          onRenamed={onChanged}
          renameFile={renameDiagramFolder}
          editRequest={editRequest}
          className="text-xs font-medium truncate flex-1 text-text"
          inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-xs"
          title="Double-click to rename"
        />
        <RowMenuKebab
          label={`Actions for ${folder.name}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${folder.name} actions`}
      />
    </div>
  );
}

export function DiagramFileCard({
  file,
  thumbnail,
  onChanged,
  onMove,
}: {
  file: DiagramFile;
  thumbnail: ReactNode;
  onChanged: () => void;
  onMove: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const menu = useContextMenu<"row">();
  const [deleting, setDeleting] = useState(false);
  const [editRequest, setEditRequest] = useState(0);
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const href = toDiagramRoutePath(file.path);

  const groups = buildVaultFileMenuGroups({
    itemLabel: "diagram",
    kind: "diagrams",
    deleting,
    onOpen: () => router.push(href),
    cursorDisabledReason: "Open in Cursor is for notes linked to a repo.",
    onCopyLocation: () => {
      void copyVaultLocation(file.path).then(
        () => toast.success("Location copied"),
        () => toast.error("Could not copy to clipboard."),
      );
    },
    onCopyMarkdown: () => {
      void copyVaultMarkdown("notes", file.path).then(
        () => toast.success("Markdown copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
      );
    },
    onShare: () => {
      void shareVaultGist("notes", file.path).then(
        () => toast.success("Live — link copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not publish."),
      );
    },
    onOneTime: () => setOneTimeOpen(true),
    onRename: () => setEditRequest((n) => n + 1),
    onDuplicate: () => {
      void duplicateVaultFile("notes", file.path).then(
        (next) => {
          toast.success("Duplicated.");
          onChanged();
          router.push(toDiagramRoutePath(next));
        },
        (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate."),
      );
    },
    onMove,
    onDelete: () => {
      void (async () => {
        const ok = await confirm({
          title: "Delete diagram",
          message: `Delete "${file.name}"? This cannot be undone.`,
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        broadcastNoteAutosaveInvalidation(file.path);
        setDeleting(true);
        try {
          const r = await fetch(`/api/notes/${toNotesApiPath(file.path)}`, { method: "DELETE" });
          if (!r.ok) throw new Error("delete failed");
          toast.success("Diagram deleted.");
          onChanged();
        } catch {
          toast.error("Couldn't delete diagram.");
        } finally {
          setDeleting(false);
        }
      })();
    },
  });

  return (
    <div className="card p-3 flex flex-col gap-2 group" {...menu.bindRow("row")}>
      <Link href={href} className="block" onContextMenu={(event) => event.preventDefault()}>
        {thumbnail}
      </Link>
      <div className="flex items-center gap-1">
        <InlineNoteRename
          noteSlug={file.path}
          displayName={file.name}
          active={false}
          onRenamed={onChanged}
          renameFile={renameNoteFile}
          editRequest={editRequest}
          className="text-xs font-medium truncate flex-1 text-text"
          inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-xs"
          title="Double-click to rename"
        />
        <RowMenuKebab
          label={`Actions for ${file.name}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${file.name} actions`}
      />
      <OneTimeShareButton
        vaultId="notes"
        path={file.path}
        hideTrigger
        open={oneTimeOpen}
        onOpenChange={setOneTimeOpen}
      />
    </div>
  );
}

export function DiagramRecentRow({
  file,
  onChanged,
  children,
}: {
  file: DiagramFile;
  onChanged: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const menu = useContextMenu<"row">();
  const [deleting, setDeleting] = useState(false);
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const href = toDiagramRoutePath(file.path);

  const groups = buildVaultFileMenuGroups({
    itemLabel: "diagram",
    kind: "diagrams",
    deleting,
    onOpen: () => router.push(href),
    cursorDisabledReason: "Open in Cursor is for notes linked to a repo.",
    onCopyLocation: () => {
      void copyVaultLocation(file.path).then(
        () => toast.success("Location copied"),
        () => toast.error("Could not copy to clipboard."),
      );
    },
    onCopyMarkdown: () => {
      void copyVaultMarkdown("notes", file.path).then(
        () => toast.success("Markdown copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
      );
    },
    onShare: () => {
      void shareVaultGist("notes", file.path).then(
        () => toast.success("Live — link copied"),
        (err) => toast.error(err instanceof Error ? err.message : "Could not publish."),
      );
    },
    onOneTime: () => setOneTimeOpen(true),
    onDuplicate: () => {
      void duplicateVaultFile("notes", file.path).then(
        (next) => {
          toast.success("Duplicated.");
          onChanged();
          router.push(toDiagramRoutePath(next));
        },
        (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate."),
      );
    },
    onDelete: () => {
      void (async () => {
        const ok = await confirm({
          title: "Delete diagram",
          message: `Delete "${file.name}"? This cannot be undone.`,
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        broadcastNoteAutosaveInvalidation(file.path);
        setDeleting(true);
        try {
          const r = await fetch(`/api/notes/${toNotesApiPath(file.path)}`, { method: "DELETE" });
          if (!r.ok) throw new Error("delete failed");
          toast.success("Diagram deleted.");
          onChanged();
        } catch {
          toast.error("Couldn't delete diagram.");
        } finally {
          setDeleting(false);
        }
      })();
    },
  });

  return (
    <li className="lib-recent-item group" {...menu.bindRow("row")}>
      {children}
      <RowMenuKebab
        label={`Actions for ${file.name}`}
        onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
      />
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${file.name} actions`}
      />
      <OneTimeShareButton
        vaultId="notes"
        path={file.path}
        hideTrigger
        open={oneTimeOpen}
        onOpenChange={setOneTimeOpen}
      />
    </li>
  );
}
