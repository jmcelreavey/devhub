"use client";

import { useCallback, useMemo, useState } from "react";
import { SkeletonRows } from "@/components/SkeletonRows";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Save,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { HoverTip } from "@/components/HoverTip";
import { ManagedRowBadges } from "@/components/SkillCatalogPanels";
import { runCollectImport } from "@/lib/collect-import-client";
import {
  catalogDisplayPrefix,
  collectImportBodyKey,
  collectScriptForKind,
  contentFileLabel,
  itemKey,
  type ManagedKind,
} from "@/lib/managed-catalog-kind";
import {
  canAddToCatalog,
  canDeleteRow,
  countImportableRows,
  isCatalogReadOnly,
  participatesInSync,
  type ManagedCatalogRow,
} from "@/lib/managed-catalog-rows";
import { useToast } from "@/lib/use-toast";

export interface ManagedCatalogListProps {
  kind: ManagedKind;
  rows: ManagedCatalogRow[];
  listRef?: React.RefObject<HTMLDivElement | null>;
  expanded: string | null;
  editing: string | null;
  content: Record<string, string>;
  loadingContent: string | null;
  dirty: Record<string, boolean>;
  editContent: string;
  setEditContent: (value: string) => void;
  setDirty: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  excludedMap: Record<string, boolean>;
  deleting: string | null;
  renamingKey: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  setExpanded: (key: string | null) => void;
  setEditing: (key: string | null) => void;
  importingName: string | null;
  setImportingName: (name: string | null) => void;
  onImported: () => void;
  onToggleRow: (row: ManagedCatalogRow) => Promise<void>;
  onSaveEdit: (name: string) => Promise<void>;
  onDelete: (row: ManagedCatalogRow) => Promise<void>;
  onRename: (oldName: string) => Promise<void>;
  onExcludeToggle: (name: string) => void;
  setRenamingKey: (key: string | null) => void;
  saving: boolean;
}

export function ManagedCatalogList(props: ManagedCatalogListProps) {
  const {
    kind,
    rows,
    listRef,
    expanded,
    editing,
    content,
    loadingContent,
    dirty,
    editContent,
    setEditContent,
    setDirty,
    excludedMap,
    deleting,
    renamingKey,
    renameValue,
    setRenameValue,
    setEditing,
    importingName,
    setImportingName,
    onImported,
    onToggleRow,
    onSaveEdit,
    onDelete,
    onRename,
    onExcludeToggle,
    setRenamingKey,
    saving,
  } = props;

  const toast = useToast();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  const importableRows = useMemo(() => rows.filter(canAddToCatalog), [rows]);
  const script = collectScriptForKind(kind);
  const importBodyKey = collectImportBodyKey(kind);
  const displayPrefix = catalogDisplayPrefix(kind);

  const toggleSelect = (name: string) => {
    setSelected((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const selectAllImportable = () => {
    const next: Record<string, boolean> = {};
    for (const row of importableRows) next[row.name] = true;
    setSelected(next);
  };

  const importNames = useCallback(
    async (names: string[]) => {
      if (names.length === 0) {
        toast.error(`Select at least one ${kind} to add to catalog.`);
        return;
      }
      setBulkRunning(names.length > 1);
      if (names.length === 1) setImportingName(names[0]);
      try {
        const code = await runCollectImport({ script, names, importBodyKey });
        if (code === 0) {
          toast.success(
            names.length === 1
              ? `Added ${displayPrefix}${names[0]} to catalog.`
              : `Added ${names.length} ${kind}s to catalog.`,
          );
          setSelected({});
          onImported();
        } else {
          toast.error(`Import exited with code ${code}.`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed.");
      } finally {
        setBulkRunning(false);
        setImportingName(null);
      }
    },
    [kind, script, importBodyKey, displayPrefix, toast, onImported, setImportingName],
  );

  const bulkNames = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <>
      {importableRows.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 mb-2"
          style={{ padding: "8px 10px", background: "var(--bg-elevated)", borderRadius: "6px" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {countImportableRows(rows)} can be added to catalog
          </span>
          <button type="button" className="btn btn-ghost text-xs" onClick={selectAllImportable} disabled={bulkRunning}>
            Select all importable
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs"
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
            disabled={bulkRunning || bulkNames.length === 0}
            onClick={() => void importNames(bulkNames)}
          >
            {bulkRunning ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Download size={12} aria-hidden />}
            Add selected to catalog{bulkNames.length > 0 ? ` (${bulkNames.length})` : ""}
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="skills-catalog-list" ref={listRef}>
        {rows.map((row) => {
          const name = row.name;
          const key = itemKey(kind, name);
          const isOpen = expanded === key;
          const isEditing = editing === key;
          const isDirty = dirty[key];
          const excluded = excludedMap[name];
          const isRenaming = renamingKey === key;
          const readOnly = isCatalogReadOnly(row);
          const canImport = canAddToCatalog(row);
          const inSync = participatesInSync(row);
          const isImporting = importingName === name || bulkRunning;

          const handleRowToggle = () => void onToggleRow(row);

          return (
            <div
              key={key}
              className="card"
              {...(kind === "skill" ? { "data-testid": "skill-row", "data-skill-name": name } : {})}
              data-row-kind={row.kind}
              style={{ padding: 0 }}
            >
              <div className="w-full flex items-center gap-2" style={{ padding: "8px 14px" }}>
                {canImport ? (
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={!!selected[name]}
                    disabled={isImporting}
                    onChange={() => toggleSelect(name)}
                    aria-label={`Select ${name} for import`}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="shrink-0" style={{ width: "13px" }} aria-hidden />
                )}
                <button
                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                  onClick={() => void handleRowToggle()}
                  aria-expanded={isOpen}
                >
                  {kind === "agent" ? (
                    <Bot size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
                  ) : (
                    <Zap size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
                  )}
                  {isRenaming ? (
                    <input
                      className="input font-medium text-sm"
                      style={{ padding: "1px 6px", width: "180px", maxWidth: "50vw" }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onRename(name);
                        if (e.key === "Escape") setRenamingKey(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium text-sm" style={{ color: "var(--text)" }}>
                      {displayPrefix}
                      {name}
                    </span>
                  )}
                  <ManagedRowBadges row={row} />
                  {isDirty && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: "var(--accent-dim)",
                        color: "var(--accent)",
                        fontWeight: 600,
                      }}
                    >
                      unsaved
                    </span>
                  )}
                </button>

                {canImport && (
                  <button
                    type="button"
                    className="btn btn-primary text-xs shrink-0"
                    style={{ padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                    disabled={isImporting}
                    onClick={(e) => {
                      e.stopPropagation();
                      void importNames([name]);
                    }}
                  >
                    {isImporting ? (
                      <Loader2 size={11} className="animate-spin" aria-hidden />
                    ) : (
                      <Download size={11} aria-hidden />
                    )}
                    Add to catalog
                  </button>
                )}

                {isRenaming && !readOnly ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost shrink-0"
                      style={{ padding: "4px 6px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onRename(name);
                      }}
                      title="Confirm rename"
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost shrink-0"
                      style={{ padding: "4px 6px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingKey(null);
                      }}
                      title="Cancel rename"
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </>
                ) : !readOnly && row.kind === "catalog" ? (
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0"
                    style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingKey(key);
                      setRenameValue(name);
                    }}
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                ) : null}

                {inSync ? (
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0"
                    style={{ padding: "4px 6px", color: excluded ? "var(--accent)" : "var(--text-subtle)" }}
                    title={
                      excluded
                        ? row.kind === "local-only"
                          ? "Excluded from prune - local copies stay on disk until you include this item again."
                          : "Excluded from sync and prune - existing copies stay on disk until you remove them manually or include this item again."
                        : row.kind === "local-only"
                          ? "Not in catalog; click to exclude from prune so local copies are kept during sync."
                          : "Included in sync/prune. Click to exclude."
                    }
                    aria-label={excluded ? `Include ${name} in sync` : `Exclude ${name} from sync`}
                    aria-pressed={!!excluded}
                    onClick={(e) => {
                      e.stopPropagation();
                      onExcludeToggle(name);
                    }}
                  >
                    {excluded ? <EyeOff size={13} strokeWidth={2} aria-hidden /> : <Eye size={13} strokeWidth={2} aria-hidden />}
                  </button>
                ) : (
                  <HoverTip label="Add to catalog first to manage via sync">
                    <span
                      className="btn btn-ghost shrink-0"
                      style={{ padding: "4px 6px", color: "var(--text-subtle)", opacity: 0.35, cursor: "not-allowed" }}
                      aria-hidden
                    >
                      <Eye size={13} strokeWidth={2} />
                    </span>
                  </HoverTip>
                )}

                {canDeleteRow(row) && (
                  <HoverTip
                    label={
                      deleting === key
                        ? "Deleting…"
                        : row.kind === "local-only"
                          ? `Delete local ${kind} ${name}`
                          : `Delete ${name}`
                    }
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(row);
                      }}
                      disabled={deleting === key}
                      className="btn btn-ghost"
                      aria-label={`Delete ${name}`}
                      style={{ padding: "4px 6px", color: "var(--text-subtle)", opacity: deleting === key ? 0.5 : 0.65 }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </HoverTip>
                )}

                <button
                  onClick={() => void handleRowToggle()}
                  className="btn btn-ghost"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                >
                  {isOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>
              {isOpen && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                      {contentFileLabel(kind, name)}
                      {row.kind === "local-only" ? " (local)" : ""}
                    </span>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => setEditing(null)}
                            className="btn btn-ghost"
                            style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            <X size={10} /> Cancel
                          </button>
                          <button
                            onClick={() => void onSaveEdit(name)}
                            disabled={saving}
                            className="btn btn-primary"
                            style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            <Save size={10} /> {saving ? "Saving..." : "Save"}
                          </button>
                        </>
                      ) : !readOnly && row.kind === "catalog" ? (
                        <button
                          onClick={() => {
                            setEditing(key);
                            setEditContent(content[key] ?? "");
                          }}
                          className="btn btn-ghost"
                          style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                          title={`Edit this ${kind}`}
                        >
                          <Edit3 size={10} /> Edit
                        </button>
                      ) : row.kind === "catalog" && readOnly ? (
                        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                          Read-only (edit in ai-tools repo)
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                          Read-only - add to catalog to edit in repo
                        </span>
                      )}
                    </div>
                  </div>
                  {loadingContent === key ? (
                    <div role="status" aria-label="Loading content">
                      <SkeletonRows count={3} height={10} />
                    </div>
                  ) : isEditing ? (
                    <textarea
                      value={editContent}
                      onChange={(e) => {
                        setEditContent(e.target.value);
                        setDirty((prev) => ({ ...prev, [key]: true }));
                      }}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        minHeight: "300px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "12px",
                        color: "var(--text)",
                        fontSize: "12px",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        lineHeight: 1.5,
                        outline: "none",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <pre
                      className="text-xs overflow-x-auto whitespace-pre-wrap"
                      style={{
                        color: "var(--text-muted)",
                        fontFamily: '"SFMono-Regular", Consolas, monospace',
                        maxHeight: "400px",
                        overflowY: "auto",
                        lineHeight: 1.5,
                      }}
                    >
                      {content[key] ?? ""}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
