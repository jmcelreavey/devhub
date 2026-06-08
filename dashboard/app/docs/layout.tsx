"use client";

import { Suspense, useState, useEffect } from "react";
import { NewVaultPathModal } from "@/components/NewVaultPathModal";
import { VaultFilesSidebar } from "@/components/VaultFilesSidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      }
    >
      <DocsLayoutInner>{children}</DocsLayoutInner>
    </Suspense>
  );
}

function DocsLayoutInner({ children }: { children: React.ReactNode }) {
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
        search={search}
        onSearch={setSearch}
        onNew={() => {
          setNewDocFolder("");
          setShowNewModal(true);
        }}
      />
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
