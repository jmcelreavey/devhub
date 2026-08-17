"use client";

import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LibraryNav, type LibraryNavGroup } from "@/components/library/LibraryNav";
import { VaultFilesSidebar } from "@/components/vault/VaultFilesSidebar";
import { useToast } from "@/lib/hooks/use-toast";
import {
  createEmptyDiagram,
  createUniqueDiagramStoragePath,
  diagramFolderHref,
  normalizeDiagramFolder,
  toDiagramRoutePath,
  toNotesApiPath,
} from "@/lib/diagram-utils";

/**
 * Client chrome for the diagrams route: resizable sidebar + area-grouped nav.
 * Mirrors DocsShell / NotesShell without inventing a third vault.
 */
export function DiagramsShell({
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
          <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
        </div>
      }
    >
      <DiagramsShellInner groups={groups}>{children}</DiagramsShellInner>
    </Suspense>
  );
}

function DiagramsShellInner({
  groups,
  children,
}: {
  groups: LibraryNavGroup[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const folder = normalizeDiagramFolder(searchParams.get("folder"));
  const groupsWithHref = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        href: diagramFolderHref(g.id),
      })),
    [groups],
  );

  const activeGroupId = useMemo(() => {
    if (folder) return folder.split("/")[0] ?? null;
    const match = pathname.match(/^\/diagrams\/([^/]+)/);
    if (match && groups.some((g) => g.id === match[1])) return match[1];
    return null;
  }, [folder, groups, pathname]);

  const isEditor = /^\/diagrams\/.+/.test(pathname);

  const createDiagram = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    const filePath = createUniqueDiagramStoragePath();
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: createEmptyDiagram() }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Could not create diagram");
      }
      toast.success("Diagram created.");
      router.push(toDiagramRoutePath(filePath));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create diagram.");
    } finally {
      setCreating(false);
    }
  }, [creating, router, toast]);

  return (
    <div className="flex h-full overflow-hidden">
      <VaultFilesSidebar
        vault="notes"
        storageId="diagrams"
        title="DIAGRAMS"
        searchPlaceholder="Filter diagrams…"
        newLabel="diagram"
        search={search}
        onSearch={setSearch}
        onNew={() => void createDiagram()}
      >
        <LibraryNav
          groups={groupsWithHref}
          search={search}
          basePath="/diagrams"
          storageKey="devhub:diagrams-nav-open"
          label="Diagrams"
          noun="diagrams"
          kind="diagrams"
          activeGroupId={activeGroupId}
        />
      </VaultFilesSidebar>
      <div
        className={
          isEditor
            ? "flex-1 min-w-0 min-h-0 overflow-hidden"
            : "flex-1 min-w-0 overflow-y-auto"
        }
      >
        {children}
      </div>
    </div>
  );
}
