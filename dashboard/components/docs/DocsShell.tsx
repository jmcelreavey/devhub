"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NewVaultPathModal } from "@/components/NewVaultPathModal";
import { LibraryNav } from "@/components/library/LibraryNav";
import { DocsSearchResults } from "@/components/docs/DocsSearchResults";
import { VaultFilesSidebar } from "@/components/vault/VaultFilesSidebar";
import type { DocNavGroup } from "@/lib/docs/doc-nav-types";

/**
 * Client chrome for the docs route: sidebar nav, search state, new-doc modal.
 *
 * The nav data is computed on the server and passed down, so the sidebar does
 * not need its own fetch and stays in sync with whatever the page rendered.
 */
export function DocsShell({
  groups,
  children,
}: {
  groups: DocNavGroup[];
  children: ReactNode;
}) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [newDocFolder, setNewDocFolder] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ folder?: string }>;
      setNewDocFolder(ce.detail?.folder ?? "");
      setShowNewModal(true);
    };
    window.addEventListener("devhub:new-doc", handler);
    return () => window.removeEventListener("devhub:new-doc", handler);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <VaultFilesSidebar
        vault="docs"
        title="DOCS"
        searchPlaceholder="Filter docs…"
        search={search}
        onSearch={setSearch}
        onNew={() => {
          setNewDocFolder("");
          setShowNewModal(true);
        }}
      >
        {search.trim().length >= 2 ? (
          <DocsSearchResults query={search} />
        ) : (
          <LibraryNav
            groups={groups.map((group) => ({ ...group, items: group.docs }))}
            search={search}
            basePath="/docs"
            storageKey="devhub:docs-nav-open"
            label="Documentation"
            noun="docs"
          />
        )}
      </VaultFilesSidebar>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {showNewModal ? (
        <NewVaultPathModal
          key={newDocFolder}
          vault="docs"
          defaultFolder={newDocFolder}
          onClose={() => setShowNewModal(false)}
        />
      ) : null}
    </div>
  );
}
