"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NewNotePathModal } from "@/components/NewNotePathModal";
import { NotesChecklistsPanel } from "@/components/notes/NotesChecklistsPanel";
import { NotesFilesSidebar } from "@/components/notes/NotesFilesSidebar";
import { type NotesPanelView } from "@/components/notes/NotesViewToggle";
import { LibraryNav, type LibraryNavGroup } from "@/components/library/LibraryNav";
import { isNotesChecklistsPanel } from "@/lib/checklists/notes-url";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { getVaultClient } from "@/lib/vault/vault-client";

const notesVault = getVaultClient("notes");

/**
 * Client chrome for the notes route.
 *
 * Lifted out of `layout.tsx` so the layout can be a server component and
 * compute the nav from disk — the sidebar needs derived note titles, and
 * deriving them client-side would mean fetching and parsing every note in the
 * browser.
 */
export function NotesShell({
  groups,
  children,
}: {
  groups: LibraryNavGroup[];
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      }
    >
      <NotesShellInner groups={groups}>{children}</NotesShellInner>
    </Suspense>
  );
}

function NotesShellInner({
  groups,
  children,
}: {
  groups: LibraryNavGroup[];
  children: ReactNode;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panel: NotesPanelView = isNotesChecklistsPanel(searchParams) ? "checklists" : "files";

  const [showNewModal, setShowNewModal] = useState(false);
  const [newNoteFolder, setNewNoteFolder] = useState("");
  const [search, setSearch] = useState("");
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);

  const initialNotePath = searchParams.get("notePath") ?? "";
  const initialScopePath = searchParams.get("scope") ?? "";

  const setPanel = useCallback(
    (next: NotesPanelView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "checklists") {
        params.set("panel", "checklists");
      } else {
        params.delete("panel");
        params.delete("notePath");
        params.delete("scope");
      }
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ folder?: string }>;
      setNewNoteFolder(ce.detail?.folder ?? "");
      setShowNewModal(true);
    };
    window.addEventListener("devhub:new-note", handler);
    return () => window.removeEventListener("devhub:new-note", handler);
  }, []);

  const deleteGroup = useCallback(
    async (group: LibraryNavGroup) => {
      const ok = await confirm({
        title: "Delete folder",
        message: `Delete folder "${group.label}" and every note inside it? This cannot be undone.`,
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;

      setDeletingGroup(group.id);
      try {
        const res = await fetch(
          `${notesVault.apiPrefix}/${notesVault.paths.apiPathFromSlug(group.id)}?dir=1`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? res.statusText);
        }
        const active =
          pathname === `/notes/area/${group.id}` ||
          group.items.some((item) => item.href === pathname);
        if (active) router.push("/notes");
        router.refresh();
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : "Could not delete folder.");
      } finally {
        setDeletingGroup(null);
      }
    },
    [confirm, pathname, router, toast],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NotesFilesSidebar
          panel={panel}
          onPanelChange={setPanel}
          search={search}
          onSearch={setSearch}
          onNew={() => setShowNewModal(true)}
          showFileSearch={panel === "files"}
        >
          <LibraryNav
            groups={groups}
            search={search}
            basePath="/notes/area"
            storageKey="devhub:notes-nav-open"
            label="Notes"
            noun="notes"
            deletingGroup={deletingGroup}
            onDeleteGroup={deleteGroup}
          />
        </NotesFilesSidebar>

        {showNewModal ? (
          <NewNotePathModal
            key={newNoteFolder || "root"}
            defaultFolder={newNoteFolder}
            onClose={() => {
              setShowNewModal(false);
              setNewNoteFolder("");
            }}
          />
        ) : null}

        <div className="flex-1 min-w-0 overflow-y-auto">
          {panel === "checklists" ? (
            <NotesChecklistsPanel
              embedded
              initialNotePath={initialNotePath}
              initialScopePath={initialScopePath}
            />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
