"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

interface FolderOption {
  path: string;
  label: string;
  depth: number;
}

function collectFolders(entries: unknown[], depth = 0): FolderOption[] {
  const folders: FolderOption[] = [];
  for (const entry of entries as Array<{
    type: string;
    name: string;
    path: string;
    children?: unknown[];
  }>) {
    if (entry.type === "dir") {
      folders.push({ path: entry.path, label: entry.name, depth });
      if (entry.children) {
        folders.push(...collectFolders(entry.children, depth + 1));
      }
    }
  }
  return folders;
}

export interface MoveVaultPathModalProps {
  vault: VaultId;
  currentPath: string;
  onClose: () => void;
  onMoved: (newPath: string) => void;
  /** Called before PATCH so in-flight autosaves cannot recreate the old path. */
  onBeforeMove?: () => void;
}

export function MoveVaultPathModal({
  vault: vaultId,
  currentPath,
  onClose,
  onMoved,
  onBeforeMove,
}: MoveVaultPathModalProps) {
  const vault = getVaultClient(vaultId);
  const extRe = new RegExp(`${vault.extension.replace(".", "\\.")}$`, "i");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const currentFolder = currentPath.includes("/")
    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
    : "";
  const currentName = currentPath.split("/").pop() ?? currentPath;
  const [selectedFolder, setSelectedFolder] = useState(currentFolder);
  const [name, setName] = useState(currentName.replace(extRe, ""));
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch(vault.treeApi)
      .then((r) => (r.ok ? r.json() : []))
      .then((tree) => {
        const allFolders = collectFolders(Array.isArray(tree) ? tree : []);
        setFolders([{ path: "", label: "(root)", depth: -1 }, ...allFolders]);
      })
      .catch(() => {});
  }, [vault.treeApi]);

  const newPath = (selectedFolder ? `${selectedFolder}/` : "") + name.trim();

  const handleMove = useCallback(async () => {
    if (!name.trim()) return;
    if (newPath === currentPath) {
      onClose();
      return;
    }
    broadcastNoteAutosaveInvalidation(currentPath);
    onBeforeMove?.();
    setMoving(true);
    setError("");
    try {
      const encoded = vault.paths.apiPathFromSlug(currentPath);
      const r = await fetch(`${vault.apiPrefix}/${encoded}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Move failed");
      }
      vault.paths.notifyTreeChanged();
      onMoved(newPath);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMoving(false);
    }
  }, [name, newPath, currentPath, onBeforeMove, onMoved, onClose, vault]);

  const title = vaultId === "docs" ? "Move doc" : "Move note";

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      style={{ background: "var(--scrim)" }}
      role="presentation"
    >
      <div
        className="modal-panel rounded-lg p-5 w-full max-w-md shadow-xl"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-vault-modal-title"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id="move-vault-modal-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
          </button>
        </div>

        <div className="mb-2">
          <label className="text-xs block mb-1" style={{ color: "var(--text-subtle)" }}>
            Destination folder
          </label>
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            className="input w-full text-sm"
            style={{ background: "var(--bg-surface)" }}
          >
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.depth > 0 ? "\u00A0\u00A0".repeat(f.depth) : ""}
                {f.depth > 0 ? "└ " : ""}
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2">
          <label className="text-xs block mb-1" style={{ color: "var(--text-subtle)" }}>
            Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleMove();
            }}
            className="input w-full text-sm"
            autoComplete="off"
          />
        </div>

        <p className="text-xs mb-3" style={{ color: "var(--text-subtle)" }}>
          New path: <code style={{ color: "var(--accent)" }}>{newPath || "(empty)"}</code>
        </p>

        {error ? (
          <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleMove()}
            disabled={moving || !name.trim() || newPath === currentPath}
            className="btn btn-primary text-xs"
          >
            {moving ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
