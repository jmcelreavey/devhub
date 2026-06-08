"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NewNotePathModal } from "@/components/NewNotePathModal";
import { NotesChecklistsPanel } from "@/components/NotesChecklistsPanel";
import { NotesFilesSidebar } from "@/components/NotesFilesSidebar";
import { type NotesPanelView } from "@/components/NotesViewToggle";
import { isNotesChecklistsPanel } from "@/lib/checklists/notes-url";

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      }
    >
      <NotesLayoutInner>{children}</NotesLayoutInner>
    </Suspense>
  );
}

function NotesLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panel: NotesPanelView = isNotesChecklistsPanel(searchParams) ? "checklists" : "files";

  const [showNewModal, setShowNewModal] = useState(false);
  const [newNoteFolder, setNewNoteFolder] = useState("");
  const [search, setSearch] = useState("");

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
        />

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
