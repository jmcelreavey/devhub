"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import { NOTE_TEMPLATES, noteTemplateById } from "@/lib/note-templates";
import { textToBlocks } from "@/lib/markdown-convert";

export interface NewVaultPathModalProps {
  vault: VaultId;
  defaultFolder?: string;
  onClose: () => void;
  onCreated?: (cleanPath: string) => void;
}

function folderPrefix(defaultFolder: string): string {
  return defaultFolder ? `${defaultFolder.replace(/\/$/, "")}/` : "";
}

export function NewVaultPathModal({
  vault: vaultId,
  defaultFolder = "",
  onClose,
  onCreated,
}: NewVaultPathModalProps) {
  const vault = getVaultClient(vaultId);
  const ext = vault.extension;
  const [path, setPath] = useState(() => folderPrefix(defaultFolder));
  const [templateId, setTemplateId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const showTemplates = vaultId === "notes";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = useCallback(async () => {
    if (!path.trim()) return;
    setCreating(true);
    setError("");
    try {
      const cleanPath = path
        .trim()
        .replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "");
      const template = showTemplates && templateId ? noteTemplateById(templateId) : undefined;
      const content = vaultId === "docs" ? "" : template ? textToBlocks(template.markdown) : [];
      const r = await fetch(`${vault.apiPrefix}/${cleanPath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed to create ${vault.itemLabel}`);
      }
      vault.paths.notifyTreeChanged();
      if (onCreated) {
        onCreated(cleanPath);
      } else {
        window.location.href = vault.paths.pageHref(cleanPath);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }, [path, onCreated, onClose, vault, vaultId, ext, showTemplates, templateId]);

  const title = vaultId === "docs" ? "New doc" : "New note";

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.4)" }}
      role="presentation"
    >
      <div
        className="modal-panel rounded-lg p-5 w-full max-w-md shadow-xl"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-vault-modal-title"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id="new-vault-modal-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
          </button>
        </div>
        <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
          Path (e.g. guides/my-topic)
        </label>
        <input
          ref={inputRef}
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreate();
            if (e.key === "Escape") onClose();
          }}
          placeholder={`folder/name${ext}`}
          className="w-full px-3 py-2 rounded text-sm mb-3"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        {showTemplates ? (
          <>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              Template
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm mb-3"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              <option value="">Blank</option>
              {NOTE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
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
            onClick={() => void handleCreate()}
            disabled={creating || !path.trim()}
            className="btn btn-primary text-xs"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
