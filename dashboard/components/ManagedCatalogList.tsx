"use client";

import { useCallback, useMemo, useState } from "react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
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
import { ManagedRowBadges } from "@/components/SkillCatalogPanels";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
  type ContextMenuItem,
} from "@/components/shell/ContextMenu";
import { runCollectImport } from "@/lib/collect/import-client";
import {
  catalogDisplayPrefix,
  collectImportBodyKey,
  collectScriptForKind,
  contentFileLabel,
  itemKey,
  type ManagedKind,
} from "@/lib/managed/catalog-kind";
import {
  canAddToCatalog,
  canDeleteRow,
  countImportableRows,
  isCatalogReadOnly,
  participatesInSync,
  type ManagedCatalogRow,
} from "@/lib/managed/catalog-rows";
import { useToast } from "@/lib/hooks/use-toast";

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
  const menu = useContextMenu<ManagedCatalogRow>();

  const menuRow = menu.target;
  const menuGroups: ContextMenuGroup[] = [];
  if (menuRow) {
    const items: ContextMenuItem[] = [];
    const rowReadOnly = isCatalogReadOnly(menuRow);
    const rowKey = itemKey(kind, menuRow.name);
    if (!rowReadOnly && menuRow.kind === "catalog") {
      items.push({
        id: "rename",
        label: "Rename",
        icon: <Pencil size={12} />,
        onSelect: () => {
          setRenamingKey(rowKey);
          setRenameValue(menuRow.name);
        },
      });
    }
    if (participatesInSync(menuRow)) {
      const excluded = !!excludedMap[menuRow.name];
      items.push({
        id: "exclude",
        label: excluded ? "Include in sync" : "Exclude from sync",
        icon: excluded ? <EyeOff size={12} /> : <Eye size={12} />,
        onSelect: () => onExcludeToggle(menuRow.name),
      });
    }
    if (canDeleteRow(menuRow)) {
      items.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={12} />,
        danger: true,
        disabled: deleting === rowKey,
        onSelect: () => void onDelete(menuRow),
      });
    }
    if (items.length) menuGroups.push({ id: "manage", items });
  }

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
          <span className="text-xs text-text-muted">
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
          const isRenaming = renamingKey === key;
          const readOnly = isCatalogReadOnly(row);
          const canImport = canAddToCatalog(row);
          const inSync = participatesInSync(row);
          const isImporting = importingName === name || bulkRunning;

          const handleRowToggle = () => void onToggleRow(row);

          return (
            <div
              key={key}
              className="card group"
              {...(kind === "skill" ? { "data-testid": "skill-row", "data-skill-name": name } : {})}
              data-row-kind={row.kind}
              style={{ padding: 0 }}
              {...(isRenaming ? {} : menu.bindRow(row))}
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
                  className="row-select flex-1 text-left flex items-center gap-2 min-w-0"
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
                    <span className="font-medium text-sm text-text">
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
                ) : (!readOnly && row.kind === "catalog") || inSync || canDeleteRow(row) ? (
                  <RowMenuKebab
                    label={`Actions for ${name}`}
                    onOpen={(x, y) => menu.openAtPoint(x, y, row)}
                  />
                ) : null}

                <button
                  onClick={() => void handleRowToggle()}
                  className="btn btn-ghost"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                >
                  {isOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>
              {/* Always mounted; grid-rows 0fr→1fr makes expand/collapse glide
                  instead of popping to full height the moment content lands. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: isOpen ? "1fr" : "0fr",
                  transition: "grid-template-rows 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <div style={{ overflow: "hidden", minHeight: 0 }}>
                  {isOpen && (
                    <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span className="text-xs font-medium text-text-muted">
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
                            <span className="text-xs text-text-subtle">
                              Read-only (edit in ai-tools repo)
                            </span>
                          ) : (
                            <span className="text-xs text-text-subtle">
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
                            fontFamily: "var(--font-mono)",
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
                            fontFamily: "var(--font-mono)",
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
              </div>
            </div>
          );
        })}
        <ContextMenu
          open={menu.target !== null}
          position={menu.position}
          groups={menuGroups}
          onClose={menu.close}
          label={menuRow ? `Actions for ${menuRow.name}` : "Catalog actions"}
        />
      </div>
    </>
  );
}
