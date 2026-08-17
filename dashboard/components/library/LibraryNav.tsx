"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
import { useToast } from "@/lib/hooks/use-toast";
import { toDiagramRoutePath, stripDiagramsPrefix } from "@/lib/diagram-utils";
import { createDiagramFolder, createDiagramInFolder, deleteDiagramFolder } from "@/lib/diagram-folder-actions";
import { ROOT_AREA_ID } from "@/lib/notes/note-areas";
import { broadcastNoteAutosaveInvalidation } from "@/lib/notes/autosave-invalidation";
import { getVaultClient } from "@/lib/vault/vault-client";
import {
  copyVaultLocation,
  copyVaultMarkdown,
  createVaultFolder,
  duplicateVaultFile,
  fileKindForRow,
  openLinkedNoteInCursor,
  renameVaultFolder,
  shareVaultGist,
  siblingRenamePath,
  vaultFolderPath,
  vaultIdForKind,
  type VaultRowKind,
} from "@/lib/vault/vault-file-actions";

export interface LibraryNavItem {
  slug: string;
  title: string;
  href: string;
  description?: string;
}

export interface LibraryNavGroup {
  id: string;
  label: string;
  /** Collapsed even when it is the active group. */
  secondary?: boolean;
  deletable?: boolean;
  /** Overrides `${basePath}/${id}` for the group heading link. */
  href?: string;
  items: LibraryNavItem[];
}

type ManualState = Record<string, boolean>;

const EMPTY: ManualState = {};

/**
 * Manual expand/collapse overrides, in sessionStorage.
 *
 * An external store rather than an effect: reading storage during an effect and
 * calling setState causes a cascading render on every mount, and a lazy
 * `useState` initialiser would read storage during SSR where it does not exist.
 * Snapshots are memoised per key so React sees a stable reference.
 */
const cache = new Map<string, { raw: string | null; value: ManualState }>();

function readManual(key: string): ManualState {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  let value: ManualState = EMPTY;
  try {
    value = raw ? (JSON.parse(raw) as ManualState) : EMPTY;
  } catch {
    value = EMPTY;
  }
  cache.set(key, { raw, value });
  return value;
}

function changeEvent(key: string): string {
  return `${key}:changed`;
}

function subscribeManual(key: string, onChange: () => void): () => void {
  const name = changeEvent(key);
  window.addEventListener(name, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(name, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeManual(key: string, next: ManualState): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode — the nav still works, it just forgets */
  }
  window.dispatchEvent(new Event(changeEvent(key)));
}

function folderPathForGroup(kind: VaultRowKind, group: LibraryNavGroup): string {
  if (kind === "notes" && group.id === ROOT_AREA_ID) return "";
  return vaultFolderPath(kind, group.id);
}

type NavTarget = { type: "file"; item: LibraryNavItem } | { type: "folder"; group: LibraryNavGroup };

/**
 * Grouped sidebar navigation for a content library.
 *
 * Deliberately not the generic `FileTree`: these libraries browse by area and
 * title, not by filename, and a nav that shows `desktop-recovery` where the
 * page says "Recovering the desktop app" is a nav people stop trusting.
 *
 * Only the group you are reading is expanded. With everything open this was a
 * long scroll — a better-labelled version of the flat file list it replaced.
 * Manual toggles are remembered per library; the active group always opens.
 */
export function LibraryNav({
  groups,
  search,
  basePath,
  storageKey,
  label,
  noun = "items",
  kind = "notes",
  deletingGroup,
  onDeleteGroup,
  activeGroupId,
}: {
  groups: LibraryNavGroup[];
  search: string;
  /** Route prefix, e.g. "/docs". Group headings link to `${basePath}/${id}`. */
  basePath: string;
  /** sessionStorage key — must differ per library or they toggle each other. */
  storageKey: string;
  /** Accessible name for the nav landmark. */
  label: string;
  noun?: string;
  kind?: VaultRowKind;
  deletingGroup?: string | null;
  onDeleteGroup?: (group: LibraryNavGroup) => void;
  /** When set, wins over pathname-derived active group (e.g. diagrams `?folder=`). */
  activeGroupId?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const menu = useContextMenu<NavTarget>();
  const [oneTime, setOneTime] = useState<{ slug: string } | null>(null);
  const query = search.trim().toLowerCase();
  const vaultId = vaultIdForKind(kind);
  const vault = getVaultClient(vaultId);
  const itemLabel = kind === "diagrams" ? "diagram" : vault.itemLabel;

  const activeGroup = useMemo(() => {
    if (activeGroupId != null && activeGroupId !== "") {
      return groups.some((group) => group.id === activeGroupId) ? activeGroupId : null;
    }
    const match = groups.find((group) => group.items.some((item) => item.href === pathname));
    if (match) return match.id;
    // Area index pages (/docs/guides) have no item of their own.
    const fromPath = pathname.replace(new RegExp(`^${basePath}/?`), "").split("/")[0];
    return groups.some((group) => group.id === fromPath) ? fromPath : null;
  }, [activeGroupId, groups, pathname, basePath]);

  const subscribe = useCallback(
    (onChange: () => void) => subscribeManual(storageKey, onChange),
    [storageKey],
  );
  const getSnapshot = useCallback(() => readManual(storageKey), [storageKey]);
  const manual = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const toggle = useCallback(
    (id: string, open: boolean) => writeManual(storageKey, { ...manual, [id]: open }),
    [manual, storageKey],
  );

  const filtered = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.title.toLowerCase().includes(query) ||
            item.slug.toLowerCase().includes(query) ||
            (item.description ?? "").toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const refresh = () => router.refresh();

  const fileGroups = (() => {
    if (menu.target?.type !== "file") return [];
    const item = menu.target.item;
    const rowKind = fileKindForRow(kind, item.slug, item.href);
    return buildVaultFileMenuGroups({
      itemLabel: rowKind === "diagrams" ? "diagram" : itemLabel,
      kind: rowKind,
      onOpen: () => router.push(item.href),
      onOpenInCursor:
        rowKind === "notes"
          ? () => {
              void openLinkedNoteInCursor(item.slug, toast).catch((err) => {
                toast.error(err instanceof Error ? err.message : "Could not open in Cursor.");
              });
            }
          : undefined,
      cursorDisabledReason:
        rowKind === "notes" ? undefined : "Open in Cursor is for notes linked to a repo.",
      onCopyLocation: () => {
        void copyVaultLocation(item.slug).then(
          () => toast.success("Location copied"),
          () => toast.error("Could not copy to clipboard."),
        );
      },
      onCopyMarkdown: () => {
        void copyVaultMarkdown(vaultId, item.slug).then(
          () => toast.success("Markdown copied"),
          (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
        );
      },
      onShare: () => {
        void shareVaultGist(vaultId, item.slug).then(
          () => toast.success("Live — link copied"),
          (err) => toast.error(err instanceof Error ? err.message : "Could not publish."),
        );
      },
      onOneTime: () => setOneTime({ slug: item.slug }),
      onRename: () => {
        void (async () => {
          const name = await prompt({
            title: `Rename ${itemLabel}`,
            confirmLabel: "Rename",
            input: { defaultValue: item.slug.split("/").pop() ?? item.slug },
          });
          const trimmed = name?.trim();
          if (!trimmed) return;
          try {
            const newSlug = await vault.paths.renameFile(item.slug, trimmed);
            toast.success("Renamed.");
            if (pathname === item.href) {
              router.push(
                rowKind === "diagrams" ? toDiagramRoutePath(newSlug) : vault.paths.pageHref(newSlug),
              );
            }
            refresh();
          } catch (err) {
            if (err instanceof Error && err.message === "unchanged") return;
            toast.error(err instanceof Error ? err.message : "Could not rename.");
          }
        })();
      },
      onDuplicate: () => {
        void duplicateVaultFile(vaultId, item.slug).then(
          (next) => {
            toast.success("Duplicated.");
            refresh();
            router.push(
              rowKind === "diagrams" ? toDiagramRoutePath(next) : vault.paths.pageHref(next),
            );
          },
          (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate."),
        );
      },
      onDelete: () => {
        void (async () => {
          const ok = await confirm({
            title: `Delete ${rowKind === "diagrams" ? "diagram" : itemLabel}`,
            message: `Delete "${item.title}"? This cannot be undone.`,
            confirmLabel: "Delete",
            variant: "danger",
          });
          if (!ok) return;
          broadcastNoteAutosaveInvalidation(item.slug);
          try {
            const res = await fetch(`${vault.apiPrefix}/${vault.paths.apiPathFromSlug(item.slug)}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(data.error ?? res.statusText);
            }
            vault.paths.notifyTreeChanged();
            if (pathname === item.href) router.push(vault.pagePrefix);
            refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : `Could not delete ${itemLabel}.`);
          }
        })();
      },
    });
  })();

  const folderGroups = (() => {
    if (menu.target?.type !== "folder") return [];
    const group = menu.target.group;
    const folderPath = folderPathForGroup(kind, group);
    const diagramRel = kind === "diagrams" ? stripDiagramsPrefix(folderPath) : "";
    return buildVaultFolderMenuGroups({
      itemLabel,
      deleting: deletingGroup === group.id,
      onNewItem: () => {
        if (kind === "diagrams") {
          void createDiagramInFolder(diagramRel)
            .then((filePath) => {
              toast.success("Diagram created.");
              refresh();
              router.push(toDiagramRoutePath(filePath));
            })
            .catch((err) => toast.error(err instanceof Error ? err.message : "Could not create diagram."));
          return;
        }
        window.dispatchEvent(
          new CustomEvent(vault.newItemEvent, { detail: { folder: folderPath } }),
        );
      },
      onNewFolder: () => {
        void (async () => {
          const name = await prompt({
            title: "New folder",
            message: folderPath
              ? `Create a folder inside "${group.label}".`
              : "Create a folder at the top level.",
            confirmLabel: "Create",
            input: { placeholder: "folder-name" },
          });
          const trimmed = name?.trim().replace(/\\/g, "/").split("/").pop() ?? "";
          if (!trimmed) return;
          try {
            if (kind === "diagrams") {
              await createDiagramFolder(diagramRel, trimmed);
            } else {
              const next = folderPath ? `${folderPath}/${trimmed}` : trimmed;
              await createVaultFolder(vaultId, next);
            }
            toast.success("Folder created.");
            refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not create folder.");
          }
        })();
      },
      onCopyPath: () => {
        void copyVaultLocation(folderPath || group.id).then(
          () => toast.success("Location copied"),
          () => toast.error("Could not copy to clipboard."),
        );
      },
      onRename: !folderPath
        ? undefined
        : () => {
            void (async () => {
              const name = await prompt({
                title: "Rename folder",
                confirmLabel: "Rename",
                input: { defaultValue: group.label },
              });
              const trimmed = name?.trim().replace(/\\/g, "/").split("/").pop() ?? "";
              if (!trimmed) return;
              try {
                await renameVaultFolder(vaultId, folderPath, siblingRenamePath(folderPath, trimmed));
                toast.success("Renamed.");
                refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not rename folder.");
              }
            })();
          },
      onDelete:
        group.deletable && onDeleteGroup
          ? () => onDeleteGroup(group)
          : kind === "notes" || !folderPath
            ? undefined
            : () => {
                void (async () => {
                  const ok = await confirm({
                    title: "Delete folder",
                    message: `Delete folder "${group.label}" and everything inside it? This cannot be undone.`,
                    confirmLabel: "Delete",
                    variant: "danger",
                  });
                  if (!ok) return;
                  try {
                    if (kind === "diagrams") await deleteDiagramFolder(folderPath);
                    else {
                      const res = await fetch(
                        `${vault.apiPrefix}/${vault.paths.apiPathFromSlug(folderPath)}?dir=1`,
                        { method: "DELETE" },
                      );
                      if (!res.ok) {
                        const data = (await res.json().catch(() => ({}))) as { error?: string };
                        throw new Error(data.error ?? res.statusText);
                      }
                      vault.paths.notifyTreeChanged();
                    }
                    toast.success("Folder deleted.");
                    refresh();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not delete folder.");
                  }
                })();
              },
    });
  })();

  if (filtered.length === 0) {
    // "No match" and "nothing to match against" are different failures, and
    // conflating them is how a broken content directory looked like a broken
    // search. Only claim a query failed when there was one.
    return (
      <p className="lib-nav-empty">
        {query
          ? `No ${noun} match “${search.trim()}”.`
          : `No ${noun} found in this workspace.`}
      </p>
    );
  }

  return (
    <nav className="lib-nav" aria-label={label}>
      {filtered.map((group) => {
        // A search must never hide its own results behind a collapsed group.
        const open = query
          ? true
          : (manual[group.id] ?? (group.id === activeGroup && !group.secondary));
        return (
          <div key={group.id} className="lib-nav-group">
            <div className="lib-nav-heading-row group" {...menu.bindRow({ type: "folder", group })}>
              <button
                type="button"
                className="lib-nav-toggle"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                onClick={() => toggle(group.id, !open)}
              >
                <ChevronDown size={11} className="lib-nav-chevron" aria-hidden />
              </button>
              <Link
                href={group.href ?? `${basePath}/${group.id}`}
                className="lib-nav-heading"
                data-active={group.id === activeGroup}
                onContextMenu={(event) => event.preventDefault()}
              >
                {group.label}
                <span className="lib-nav-count">{group.items.length}</span>
              </Link>
              <RowMenuKebab
                label={`Actions for ${group.label}`}
                onOpen={(x, y) => menu.openAtPoint(x, y, { type: "folder", group })}
              />
            </div>
            {open ? (
              <ul className="lib-nav-list">
                {group.items.map((item) => (
                  <li key={item.slug} className="lib-nav-item group" {...menu.bindRow({ type: "file", item })}>
                    <Link
                      href={item.href}
                      className="lib-nav-link"
                      data-active={pathname === item.href}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {item.title}
                    </Link>
                    <RowMenuKebab
                      label={`Actions for ${item.title}`}
                      onOpen={(x, y) => menu.openAtPoint(x, y, { type: "file", item })}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={menu.target?.type === "file" ? fileGroups : folderGroups}
        onClose={menu.close}
        label={
          menu.target?.type === "file"
            ? `${menu.target.item.title} actions`
            : menu.target
              ? `${menu.target.group.label} actions`
              : "Actions"
        }
      />
      {oneTime ? (
        <OneTimeShareButton
          vaultId={vaultId}
          path={oneTime.slug}
          hideTrigger
          open
          onOpenChange={(open) => {
            if (!open) setOneTime(null);
          }}
        />
      ) : null}
    </nav>
  );
}
