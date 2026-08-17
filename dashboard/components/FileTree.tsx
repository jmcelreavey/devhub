"use client";

import { useCallback, useEffect, useState, type HTMLAttributes } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { InlineNoteRename } from "@/components/InlineNoteRename";
import { OneTimeShareButton } from "@/components/OneTimeShareButton";
import {
  buildVaultFileMenuGroups,
  buildVaultFolderMenuGroups,
} from "@/components/vault/vaultRowMenus";
import {
  copyVaultLocation,
  copyVaultMarkdown,
  createVaultFolder,
  duplicateVaultFile,
  openLinkedNoteInCursor,
  renameVaultFolder,
  shareVaultGist,
} from "@/lib/vault/vault-file-actions";
import { SortableList, SortableDragProvider } from "@/components/ui/SortableList";
import { filterNotesSidebarTree } from "@/lib/notes/tree-sidebar-filter";
import { getVaultClient, type VaultClientConfig } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import type { TreeEntry } from "@/lib/vault/vault-storage";
import {
  broadcastNoteAutosaveInvalidation,
  collectTreeNoteSlugs,
} from "@/lib/notes/autosave-invalidation";

function TreeNode({
  entry,
  vault,
  rootEntries,
  depth = 0,
  onTreeChange,
  onSelect,
  dragHandleProps,
  isDragging = false,
  isDropTarget = false,
  disableReorder = false,
}: {
  entry: TreeEntry;
  vault: VaultClientConfig;
  rootEntries: TreeEntry[];
  depth?: number;
  onTreeChange?: () => void;
  onSelect?: (path: string) => void;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  isDragging?: boolean;
  isDropTarget?: boolean;
  disableReorder?: boolean;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [deleting, setDeleting] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [editRequest, setEditRequest] = useState(0);
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const menu = useContextMenu<"row">();
  const pathname = usePathname();
  const router = useRouter();
  const showToast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { paths, apiPrefix, pagePrefix, itemLabel, newItemEvent } = vault;
  const vaultId = vault.id;
  const extRe = new RegExp(`${vault.extension.replace(".", "\\.")}$`, "i");

  const rowStyle = {
    paddingLeft: `${8 + depth * 12}px`,
    opacity: isDragging ? 0.45 : undefined,
    background: isDropTarget ? "var(--bg-elevated)" : undefined,
    outline: isDropTarget ? "1px solid var(--accent)" : undefined,
  };

  if (entry.type === "dir") {
    const folderPath = entry.path.replace(/\\/g, "/");

    const handleDeleteFolder = async () => {
      const ok = await confirm({
        title: "Delete folder",
        message: `Delete folder "${entry.name}" and every ${itemLabel} inside it? This cannot be undone.`,
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      for (const slug of collectTreeNoteSlugs(entry, paths.normalizeSlug)) {
        broadcastNoteAutosaveInvalidation(slug);
      }
      setDeleting(true);
      try {
        const res = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(folderPath)}?dir=1`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? res.statusText);
        }
        const prefix = `${pagePrefix}/${folderPath}`;
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
          router.push(pagePrefix);
        }
        onTreeChange?.();
      } catch (err) {
        console.error(err);
        showToast.error(err instanceof Error ? err.message : "Could not delete folder.");
      } finally {
        setDeleting(false);
      }
    };

    const handleNewFolder = async () => {
      const name = await prompt({
        title: "New folder",
        message: `Create a folder inside \"${entry.name}\".`,
        confirmLabel: "Create",
        input: { placeholder: "folder-name" },
      });
      const trimmed = name?.trim().replace(/\\/g, "/").split("/").pop() ?? "";
      if (!trimmed) return;
      try {
        await createVaultFolder(vaultId, `${folderPath}/${trimmed}`);
        showToast.success("Folder created.");
        onTreeChange?.();
      } catch (err) {
        showToast.error(err instanceof Error ? err.message : "Could not create folder.");
      }
    };

    const handleRenameFolder = async () => {
      const name = await prompt({
        title: "Rename folder",
        confirmLabel: "Rename",
        input: { defaultValue: entry.name },
      });
      const trimmed = name?.trim().replace(/\\/g, "/").split("/").pop() ?? "";
      if (!trimmed || trimmed === entry.name) return;
      const parent = folderPath.includes("/") ? folderPath.slice(0, folderPath.lastIndexOf("/")) : "";
      const newPath = parent ? `${parent}/${trimmed}` : trimmed;
      try {
        await renameVaultFolder(vaultId, folderPath, newPath);
        showToast.success("Renamed.");
        onTreeChange?.();
      } catch (err) {
        showToast.error(err instanceof Error ? err.message : "Could not rename folder.");
      }
    };

    const folderMenuGroups = buildVaultFolderMenuGroups({
      itemLabel,
      deleting,
      onNewItem: () => {
        window.dispatchEvent(
          new CustomEvent(newItemEvent, { detail: { folder: entry.path } }),
        );
      },
      onNewFolder: () => void handleNewFolder(),
      onCopyPath: () => {
        void copyVaultLocation(folderPath).then(
          () => showToast.success("Location copied"),
          () => showToast.error("Could not copy to clipboard."),
        );
      },
      onRename: () => void handleRenameFolder(),
      onDelete: () => void handleDeleteFolder(),
    });

    return (
      <div>
        <div
          className="group flex min-w-0 max-w-full items-center gap-0.5 pr-1"
          style={rowStyle}
          {...menu.bindRow("row")}
        >
          <TreeDragHandle
            label={entry.name}
            dragHandleProps={disableReorder ? undefined : dragHandleProps}
          />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-text-muted"
          >
            <span>{open ? "▾" : "▸"}</span>
            <span className="truncate">{entry.name}</span>
          </button>
          <RowMenuKebab
            label={`Actions for ${entry.name}`}
            onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
          />
        </div>
        <ContextMenu
          open={menu.target !== null}
          position={menu.position}
          groups={folderMenuGroups}
          onClose={menu.close}
          label={`${entry.name} actions`}
        />
        {open && entry.children && (
          <div className="min-w-0">
            <TreeLevel
              entries={entry.children}
              vault={vault}
              rootEntries={rootEntries}
              depth={depth + 1}
              onTreeChange={onTreeChange}
              onSelect={onSelect}
              disableReorder={disableReorder}
            />
          </div>
        )}
      </div>
    );
  }

  const slug = paths.normalizeSlug(entry.path);
  const href = paths.pageHref(slug);
  const label = entry.name.replace(extRe, "");
  const linkActive = paths.isPageActive(pathname, slug);

  const handleRenamed = (newSlug: string) => {
    onTreeChange?.();
    if (paths.isPageActive(pathname, slug)) {
      router.push(paths.pageHref(newSlug));
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onSelect) {
      e.preventDefault();
      onSelect(slug);
    }
  };

  const sharedLinkClass = "flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-xs overflow-hidden";
  const sharedLinkStyle = {
    color: linkActive ? "var(--text)" : "var(--text-muted)",
    background: linkActive ? "var(--bg-elevated)" : "transparent",
  };

  const inner = (
    <>
      <span className="text-text-subtle">·</span>
      <InlineNoteRename
        noteSlug={slug}
        displayName={label}
        active={linkActive}
        onEditingChange={setEditingLabel}
        onRenamed={handleRenamed}
        renameFile={vault.paths.renameFile}
        editRequest={editRequest}
        className="truncate min-w-0 flex-1"
        title={linkActive ? "Click to rename" : "Double-click to rename"}
      />
    </>
  );

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete ${itemLabel}`,
      message: `Delete "${label}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    broadcastNoteAutosaveInvalidation(slug);
    setDeleting(true);
    try {
      const res = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(entry.path)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? res.statusText);
      }
      onTreeChange?.();
      if (paths.isPageActive(pathname, slug)) {
        router.push(pagePrefix);
      }
    } catch (err) {
      console.error(err);
      showToast.error(err instanceof Error ? err.message : `Could not delete ${itemLabel}.`);
    } finally {
      setDeleting(false);
    }
  };

  const openFile = () => {
    if (onSelect) {
      onSelect(slug);
      return;
    }
    router.push(href);
  };

  const fileMenuGroups = buildVaultFileMenuGroups({
    itemLabel,
    kind: vaultId,
    deleting,
    onOpen: openFile,
    onOpenInCursor:
      vaultId === "notes"
        ? () => {
            void openLinkedNoteInCursor(slug, showToast).catch((err) => {
              showToast.error(err instanceof Error ? err.message : "Could not open in Cursor.");
            });
          }
        : undefined,
    onCopyLocation: () => {
      void copyVaultLocation(slug).then(
        () => showToast.success("Location copied"),
        () => showToast.error("Could not copy to clipboard."),
      );
    },
    onCopyMarkdown: () => {
      void copyVaultMarkdown(vaultId, slug).then(
        () => showToast.success("Markdown copied"),
        (err) => showToast.error(err instanceof Error ? err.message : "Could not copy markdown."),
      );
    },
    onShare: () => {
      void shareVaultGist(vaultId, slug).then(
        () => showToast.success("Live — link copied"),
        (err) => showToast.error(err instanceof Error ? err.message : "Could not publish."),
      );
    },
    onOneTime: () => setOneTimeOpen(true),
    onRename: () => setEditRequest((n) => n + 1),
    onDuplicate: () => {
      void duplicateVaultFile(vaultId, slug).then(
        (next) => {
          showToast.success("Duplicated.");
          onTreeChange?.();
          if (!onSelect) router.push(paths.pageHref(next));
        },
        (err) => showToast.error(err instanceof Error ? err.message : "Could not duplicate."),
      );
    },
    onDelete: () => void handleDelete(),
  });

  return (
    <>
    <div
      className="group flex min-w-0 max-w-full items-center gap-0.5 pr-1"
      style={rowStyle}
      {...(editingLabel ? {} : menu.bindRow("row"))}
    >
      {!editingLabel && (
        <TreeDragHandle
          label={label}
          dragHandleProps={disableReorder ? undefined : dragHandleProps}
        />
      )}
      {onSelect ? (
        <button
          type="button"
          className={sharedLinkClass}
          style={sharedLinkStyle}
          onClick={editingLabel ? undefined : handleClick}
        >
          {inner}
        </button>
      ) : (
        // Keep the host element type stable across edit mode. Swapping it to a
        // <div> while renaming remounts InlineNoteRename and wipes its state,
        // which makes the input flicker open then immediately close.
        <Link
          href={href}
          className={sharedLinkClass}
          style={sharedLinkStyle}
          onClick={editingLabel ? (e) => e.preventDefault() : undefined}
          onContextMenu={(e) => e.preventDefault()}
        >
          {inner}
        </Link>
      )}
      {!editingLabel && (
        <RowMenuKebab
          label={`Actions for ${label}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      )}
    </div>
    <ContextMenu
      open={menu.target !== null}
      position={menu.position}
      groups={fileMenuGroups}
      onClose={menu.close}
      label={`${label} actions`}
    />
    <OneTimeShareButton
      vaultId={vaultId}
      path={slug}
      hideTrigger
      open={oneTimeOpen}
      onOpenChange={setOneTimeOpen}
    />
    </>
  );
}

function TreeDragHandle({
  label,
  dragHandleProps,
}: {
  label: string;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
}) {
  if (!dragHandleProps) return null;

  return (
    <button
      type="button"
      {...dragHandleProps}
      title="Drag to reorder. Arrow keys also work."
      className="shrink-0 rounded p-0.5 reveal-on-hover focus:opacity-100"
      style={{ color: "var(--text-subtle)", cursor: "grab" }}
      aria-label={`Drag to reorder ${label}`}
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical size={12} strokeWidth={2.5} aria-hidden />
    </button>
  );
}

function TreeLevel({
  entries,
  vault,
  rootEntries = entries,
  depth = 0,
  onTreeChange,
  onSelect,
  disableReorder = false,
}: {
  entries: TreeEntry[];
  vault: VaultClientConfig;
  rootEntries?: TreeEntry[];
  depth?: number;
  onTreeChange?: () => void;
  onSelect?: (path: string) => void;
  disableReorder?: boolean;
}) {
  const showToast = useToast();

  const moveAcrossFolders = async (sourcePath: string, targetEntry: TreeEntry, targetSiblings: TreeEntry[]) => {
    if (targetSiblings.some((entry) => entry.path === sourcePath)) return false;

    const sourceEntry = findTreeEntry(rootEntries, sourcePath);
    if (!sourceEntry) return true;

    const sourceSlug = vault.paths.normalizeSlug(sourceEntry.path);
    const targetSlug = vault.paths.normalizeSlug(targetEntry.path);
    const targetFolder = targetEntry.type === "dir" ? targetSlug : parentPath(targetSlug);
    if (sourceEntry.type === "dir" && (targetFolder === sourceSlug || targetFolder.startsWith(`${sourceSlug}/`))) {
      showToast.error("Can't move a folder into itself.");
      return true;
    }

    const sourceName = sourceSlug.split("/").pop() ?? sourceSlug;
    const newPath = targetFolder ? `${targetFolder}/${sourceName}` : sourceName;
    if (newPath === sourceSlug) return true;

    try {
      if (sourceEntry.type === "dir") {
        for (const slug of collectTreeNoteSlugs(sourceEntry, vault.paths.normalizeSlug)) {
          broadcastNoteAutosaveInvalidation(slug);
        }
      } else {
        broadcastNoteAutosaveInvalidation(sourceSlug);
      }
      const res = await fetch(`${vault.apiPrefix}/${vault.paths.apiPathFromSlug(sourceEntry.path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath, dir: sourceEntry.type === "dir" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? res.statusText);
      }

      const orderedPaths = targetEntry.type === "dir"
        ? [...(targetEntry.children ?? []).map((entry) => entry.path), newPath]
        : insertBefore(
            targetSiblings.map((entry) => entry.path),
            newPath,
            targetEntry.path,
          );
      await reorderEntriesByPath(orderedPaths);
      vault.paths.notifyTreeChanged();
      onTreeChange?.();
    } catch (err) {
      console.error(err);
      showToast.error(err instanceof Error ? err.message : `Could not move ${vault.itemLabel}.`);
    }

    return true;
  };

  const reorderEntriesByPath = async (orderedPaths: string[]) => {
    try {
      const res = await fetch(vault.orderApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: orderedPaths }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? res.statusText);
      }
      onTreeChange?.();
    } catch (err) {
      console.error(err);
      showToast.error(err instanceof Error ? err.message : `Could not reorder ${vault.itemLabel}.`);
    }
  };

  const reorderEntries = (orderedEntries: TreeEntry[]) =>
    reorderEntriesByPath(orderedEntries.map((entry) => entry.path));

  return (
    <SortableList
      items={entries}
      getId={(entry) => entry.path}
      disabled={disableReorder}
      onReorder={reorderEntries}
      onDropItem={moveAcrossFolders}
      renderItem={(entry, { dragHandleProps, isDragging, isDropTarget }) => (
        <TreeNode
          entry={entry}
          vault={vault}
          rootEntries={rootEntries}
          depth={depth}
          onTreeChange={onTreeChange}
          onSelect={onSelect}
          dragHandleProps={dragHandleProps}
          isDragging={isDragging}
          isDropTarget={isDropTarget}
          disableReorder={disableReorder}
        />
      )}
    />
  );
}

function filterTree(entries: TreeEntry[], q: string): TreeEntry[] {
  if (!q) return entries;
  const lower = q.toLowerCase();
  return entries
    .map((e) => {
      if (e.type === "dir" && e.children) {
        const filtered = filterTree(e.children, q);
        if (filtered.length > 0) return { ...e, children: filtered };
        if (e.name.toLowerCase().includes(lower)) return e;
        return null;
      }
      return e.name.toLowerCase().includes(lower) ? e : null;
    })
    .filter(Boolean) as TreeEntry[];
}

function parentPath(input: string): string {
  const index = input.lastIndexOf("/");
  return index === -1 ? "" : input.slice(0, index);
}

function findTreeEntry(entries: TreeEntry[], targetPath: string): TreeEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    if (entry.type === "dir" && entry.children) {
      const child = findTreeEntry(entry.children, targetPath);
      if (child) return child;
    }
  }
  return null;
}

function insertBefore(paths: string[], newPath: string, targetPath: string): string[] {
  const next = paths.filter((path) => path !== newPath);
  const targetIndex = next.indexOf(targetPath);
  if (targetIndex === -1) return [...next, newPath];
  next.splice(targetIndex, 0, newPath);
  return next;
}

export function FileTree({
  vault: vaultId = "notes",
  search = "",
  onSelect,
}: {
  vault?: VaultId;
  search?: string;
  onSelect?: (path: string) => void;
}) {
  const vault = getVaultClient(vaultId);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reloadTree = useCallback(() => {
    fetch(vault.treeApi)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(
            text.startsWith("<!DOCTYPE")
              ? `File list failed (${r.status}). Restart the dev server if you recently pulled changes.`
              : `File list failed (${r.status}): ${text.slice(0, 200)}`,
          );
        }
        return r.json() as Promise<TreeEntry[]>;
      })
      .then((data) => {
        const raw = Array.isArray(data) ? data : [];
        const filtered =
          vaultId === "notes" ? filterNotesSidebarTree(raw) : raw;
        setTree(filtered);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoaded(true));
  }, [vault.treeApi, vaultId]);

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);

  useEffect(() => {
    const onRefresh = () => reloadTree();
    window.addEventListener(vault.treeRefreshEvent, onRefresh);
    return () => window.removeEventListener(vault.treeRefreshEvent, onRefresh);
  }, [reloadTree, vault.treeRefreshEvent]);

  const visible = search ? filterTree(tree, search) : tree;

  if (!loaded) {
    // No shimmer: an empty rail until the tree arrives reads calmer than
    // placeholder bars (site-wide no-skeleton policy).
    return <nav className="min-w-0 overflow-x-hidden overflow-y-auto py-2" aria-busy="true" />;
  }

  return (
    <nav className="min-w-0 overflow-x-hidden overflow-y-auto py-2">
      <SortableDragProvider>
        <TreeLevel
          entries={visible}
          vault={vault}
          rootEntries={tree}
          onTreeChange={reloadTree}
          onSelect={onSelect}
          disableReorder={!!search}
        />
      </SortableDragProvider>
      {visible.length === 0 && search && (
        <div className="px-3 py-4 text-xs text-text-subtle">
          No {vault.itemLabelPlural} match &ldquo;{search}&rdquo;
        </div>
      )}
    </nav>
  );
}
