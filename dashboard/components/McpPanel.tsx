"use client";

import { useCallback, useEffect, useState } from "react";
import { SkeletonRows } from "@/components/SkeletonRows";
import {
  Link2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Pencil,
  Save,
  Trash2,
  X,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { SyncButton } from "@/components/SyncButton";
import { LocalMcpImportPanel } from "@/components/LocalMcpImportPanel";
import { HoverTip } from "@/components/HoverTip";
import {
  MCP_SYNC_EXCLUDE_CHANGED_EVENT,
  MCP_SYNC_EXCLUDE_STORAGE_KEY,
  readExcludedMcpIdsFromStorage,
  writeExcludedMcpIdsToStorage,
} from "@/lib/mcp-sync-exclude-storage";

type McpCatalogScope = "repo" | "personal";

interface ServerInfo {
  name: string;
  description: string | null;
  command: string;
  scope: McpCatalogScope;
}

function serverKey(server: Pick<ServerInfo, "name" | "scope">): string {
  return `${server.scope}:${server.name}`;
}

function mcpApiPath(name: string, scope: McpCatalogScope): string {
  const q = scope === "personal" ? "?scope=personal" : "";
  return `/api/mcp/${encodeURIComponent(name)}${q}`;
}

function catalogPathLabel(scope: McpCatalogScope): string {
  return scope === "personal" ? "~/.config/devhub/mcp-personal/" : "mcp/shared/";
}

export function McpPanel() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [serverContent, setServerContent] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [excludedFromSync, setExcludedFromSync] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newScope, setNewScope] = useState<McpCatalogScope>("personal");
  const [creating, setCreating] = useState(false);
  const [syncPrune, setSyncPrune] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  const reloadList = useCallback(() => {
    fetch("/api/mcp")
      .then((r) => r.json())
      .then(setServers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reloadList();
  }, [reloadList]);

  useEffect(() => {
    const applyFromStorage = () => {
      const ids = readExcludedMcpIdsFromStorage();
      const next: Record<string, boolean> = {};
      for (const id of ids) next[id] = true;
      setExcludedFromSync(next);
    };
    applyFromStorage();
    window.addEventListener(MCP_SYNC_EXCLUDE_CHANGED_EVENT, applyFromStorage);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MCP_SYNC_EXCLUDE_STORAGE_KEY) applyFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MCP_SYNC_EXCLUDE_CHANGED_EVENT, applyFromStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const loadContent = useCallback(
    async (server: ServerInfo) => {
      const key = serverKey(server);
      if (serverContent[key]) return;
      setLoadingContent(key);
      try {
        const r = await fetch(mcpApiPath(server.name, server.scope));
        const data = await r.json();
        setServerContent((prev) => ({ ...prev, [key]: data.content ?? "" }));
      } catch {
        setServerContent((prev) => ({ ...prev, [key]: "Failed to load." }));
      } finally {
        setLoadingContent(null);
      }
    },
    [serverContent],
  );

  const toggleServer = useCallback(
    async (server: ServerInfo) => {
      const key = serverKey(server);
      if (expanded === key) {
        setExpanded(null);
        if (editing === key) setEditing(null);
        return;
      }
      setExpanded(key);
      if (editing && editing !== key) setEditing(null);
      await loadContent(server);
    },
    [expanded, editing, loadContent],
  );

  const startEdit = useCallback(
    (server: ServerInfo) => {
      setEditContent(serverContent[serverKey(server)] ?? "");
      setEditing(serverKey(server));
    },
    [serverContent],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditContent("");
  }, []);

  const saveEdit = useCallback(
    async (server: ServerInfo) => {
      const key = serverKey(server);
      setSaving(true);
      try {
        const r = await fetch(mcpApiPath(server.name, server.scope), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Save failed");
        setServerContent((prev) => ({ ...prev, [key]: editContent }));
        setEditing(null);
        reloadList();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    },
    [editContent, reloadList, toast],
  );

  const deleteServer = useCallback(
    async (server: ServerInfo) => {
      const key = serverKey(server);
      const ok = await confirm({
        title: "Delete this MCP server?",
        message:
          server.scope === "personal"
            ? `This removes ${catalogPathLabel(server.scope)}${server.name}.json from your machine. Run Sync MCP to drop it from tool configs.`
            : `This permanently removes mcp/shared/${server.name}.json. Run Sync MCP afterwards to remove it from your tool configs too.`,
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      setDeleting(key);
      try {
        const r = await fetch(mcpApiPath(server.name, server.scope), { method: "DELETE" });
        if (!r.ok) throw new Error(await r.text());
        setServers((prev) => prev.filter((s) => serverKey(s) !== key));
        if (expanded === key) setExpanded(null);
        if (editing === key) setEditing(null);
        toast.success(`Deleted "${server.name}".`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't delete server.");
      } finally {
        setDeleting(null);
      }
    },
    [confirm, toast, expanded, editing],
  );

  const handleRename = useCallback(
    async (server: ServerInfo) => {
      const key = serverKey(server);
      const raw = renameValue.trim();
      if (!raw || raw === server.name) {
        setRenamingName(null);
        return;
      }
      try {
        const r = await fetch(mcpApiPath(server.name, server.scope), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: raw }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Rename failed");
        const newKey = `${server.scope}:${data.name}`;
        setServers((prev) =>
          prev.map((s) => (serverKey(s) === key ? { ...s, name: data.name } : s)),
        );
        if (expanded === key) setExpanded(newKey);
        if (editing === key) setEditing(newKey);
        setServerContent((prev) => {
          const next = { ...prev };
          if (next[key] !== undefined) {
            next[newKey] = next[key];
            delete next[key];
          }
          return next;
        });
        setRenamingName(null);
        toast.success(`Renamed to "${data.name}".`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Rename failed.");
      }
    },
    [renameValue, expanded, editing, toast],
  );

  const filtered = query
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description?.toLowerCase().includes(query.toLowerCase()),
      )
    : servers;

  const excludeList = Object.entries(excludedFromSync)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const createServer = useCallback(async () => {
    const slug = newName.trim();
    if (!slug) {
      toast.error("Enter a server name.");
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: slug,
          command: newCommand.trim() || undefined,
          scope: newScope,
        }),
      });
      const data = (await r.json()) as { error?: string; name?: string };
      if (!r.ok) throw new Error(data.error ?? "Create failed");
      toast.success(`Created MCP server ${data.name}`);
      setShowNew(false);
      setNewName("");
      setNewCommand("");
      reloadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create server.");
    } finally {
      setCreating(false);
    }
  }, [newName, newCommand, newScope, toast, reloadList]);

  return (
    <>
      <p
        className="text-xs"
        style={{ color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "12px" }}
      >
        <strong style={{ color: "var(--text)" }}>Repo</strong> servers live in <code>mcp/shared/</code> (git).
        <strong style={{ color: "var(--text)" }}> Personal</strong> servers live in{" "}
        <code>~/.config/devhub/mcp-personal/</code> (machine-only - sync to every tool, never committed).
        Click <strong style={{ color: "var(--text)" }}>Sync all tools</strong> to push repo + personal catalogs to{" "}
        <code>~/.claude.json</code>, <code>~/.codex/mcp.json</code>,{" "}
        <code>~/.cursor/mcp.json</code>, and the <code>mcp</code> block in{" "}
        <code>~/.config/opencode/opencode.json</code>. Prune is off by default (same as Skills/Agents); enable it
        to remove recognized MCP servers in those configs that are no longer in the repo unless they are
        eye-ignored. Use <strong style={{ color: "var(--text)" }}>Import from local tools</strong> first if you
        want to keep a tool-only server such as agentmemory or a remote HTTP entry in the shared config.
        The eye toggle marks a server as ignored: not written, not pruned. Stored in your browser as{" "}
        <code className="font-mono">{`localStorage["${MCP_SYNC_EXCLUDE_STORAGE_KEY}"]`}</code>.
      </p>

      <LocalMcpImportPanel onImported={reloadList} />

      <label
        className="flex items-start gap-2 text-xs mb-2 cursor-pointer"
        style={{ color: "var(--text-muted)", lineHeight: 1.45 }}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={syncPrune}
          onChange={(e) => setSyncPrune(e.target.checked)}
        />
        <span>
          <strong style={{ color: "var(--text)" }}>Prune</strong> tool MCP configs: delete recognized MCP
          entries from tool configs that are no longer in <code className="font-mono">mcp/shared/</code>{" "}
          (and not eye-ignored). Import local-only remote / HTTP entries first if you want to keep them.
        </span>
      </label>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="input"
          placeholder="Filter servers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 160px" }}
        />
        <button
          type="button"
          className="btn btn-ghost text-xs"
          style={{ display: "flex", alignItems: "center", gap: "4px" }}
          onClick={() => setShowNew(true)}
        >
          <Plus size={12} aria-hidden /> New server
        </button>
        <SyncButton
          script="sync_mcp_servers"
          label="Sync all tools"
          excludeServers={excludeList.length ? excludeList : undefined}
          prune={syncPrune}
          successMessage={
            syncPrune
              ? "MCP synced; repo is source of truth (stale recognized entries pruned)."
              : "MCP synced to all tools (repo + personal); extra tool-only entries were preserved."
          }
        />
      </div>

      {showNew && (
        <div
          className="card mb-3"
          style={{ padding: "12px 14px", borderColor: "var(--accent)", borderWidth: "1px" }}
        >
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text)" }}>
            New MCP server
          </div>
          <div className="flex flex-col gap-2">
            <input
              className="input font-mono text-xs"
              placeholder="server-id (e.g. notes)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              spellCheck={false}
            />
            <input
              className="input font-mono text-xs"
              placeholder={
                newScope === "personal"
                  ? "command (optional, e.g. npx)"
                  : "command (optional, e.g. REPO_ROOT/path/to/binary)"
              }
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              spellCheck={false}
            />
            <div className="flex gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="new-mcp-scope"
                  checked={newScope === "personal"}
                  onChange={() => setNewScope("personal")}
                />
                Personal (not in git)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="new-mcp-scope"
                  checked={newScope === "repo"}
                  onChange={() => setNewScope("repo")}
                />
                Repo (mcp/shared)
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setShowNew(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={creating || !newName.trim()}
                onClick={() => void createServer()}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div role="status" aria-label="Loading MCP servers">
          <SkeletonRows count={3} height={44} />
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((server) => {
          const key = serverKey(server);
          const isOpen = expanded === key;
          const isEditing = editing === key;
          const isRenaming = renamingName === key;
          return (
            <div key={key} className="card" style={{ padding: 0 }}>
              <div className="w-full flex items-center gap-2" style={{ padding: "8px 14px" }}>
                <button
                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  onClick={() => toggleServer(server)}
                  aria-expanded={isOpen}
                >
                  <Link2 size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
                  {isRenaming ? (
                    <input
                      className="input font-medium text-sm font-mono"
                      style={{ padding: "1px 6px", width: "180px", maxWidth: "50vw" }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename(server);
                        if (e.key === "Escape") setRenamingName(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="font-medium text-sm font-mono" style={{ color: "var(--text)" }}>
                        {server.name}
                      </span>
                      {server.scope === "personal" && (
                        <span
                          className="badge badge-muted shrink-0"
                          style={{ fontSize: "10px", padding: "1px 6px" }}
                        >
                          personal
                        </span>
                      )}
                    </>
                  )}
                  {!isRenaming && server.description && (
                    <span
                      className="text-xs truncate"
                      style={{ color: "var(--text-subtle)" }}
                      title={server.description}
                    >
                      - {server.description}
                    </span>
                  )}
                </button>
                {isRenaming ? (
                  <>
                    <button type="button" className="btn btn-ghost shrink-0" style={{ padding: "4px 6px" }} onClick={(e) => { e.stopPropagation(); void handleRename(server); }} title="Confirm rename"><Pencil size={13} aria-hidden /></button>
                    <button type="button" className="btn btn-ghost shrink-0" style={{ padding: "4px 6px" }} onClick={(e) => { e.stopPropagation(); setRenamingName(null); }} title="Cancel rename"><X size={13} aria-hidden /></button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost shrink-0" style={{ padding: "4px 6px", color: "var(--text-subtle)" }} title="Rename" onClick={(e) => { e.stopPropagation(); setRenamingName(key); setRenameValue(server.name); }}><Pencil size={13} aria-hidden /></button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  style={{
                    padding: "4px 6px",
                    color: excludedFromSync[server.name] ? "var(--accent)" : "var(--text-subtle)",
                  }}
                  title={
                    excludedFromSync[server.name]
                      ? "Ignored on sync (not written, not pruned). Click to include again."
                      : "Included in sync. Click to ignore (not written, not pruned in tool configs)."
                  }
                  aria-pressed={!!excludedFromSync[server.name]}
                  aria-label={
                    excludedFromSync[server.name]
                      ? `Include ${server.name} in sync`
                      : `Ignore ${server.name} on sync`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setExcludedFromSync((prev) => {
                      const next = { ...prev, [server.name]: !prev[server.name] };
                      const list = Object.entries(next)
                        .filter(([, v]) => v)
                        .map(([k]) => k);
                      writeExcludedMcpIdsToStorage(list);
                      return next;
                    });
                  }}
                >
                  {excludedFromSync[server.name] ? (
                    <EyeOff size={13} strokeWidth={2} aria-hidden />
                  ) : (
                    <Eye size={13} strokeWidth={2} aria-hidden />
                  )}
                </button>
                <HoverTip label={deleting === key ? "Deleting…" : `Delete ${server.name}`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteServer(server);
                    }}
                    disabled={deleting === key}
                    className="btn btn-ghost"
                    aria-label={`Delete ${server.name}`}
                    style={{
                      padding: "4px 6px",
                      color: "var(--text-subtle)",
                      opacity: deleting === key ? 0.5 : 0.65,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--danger)";
                      e.currentTarget.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-subtle)";
                      e.currentTarget.style.opacity = "0.65";
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </HoverTip>
                <button
                  onClick={() => toggleServer(server)}
                  className="btn btn-ghost"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                >
                  {isOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>
              {isOpen && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "8px",
                    }}
                  >
                    <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                      {catalogPathLabel(server.scope)}
                      {server.name}.json
                    </span>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => cancelEdit()}
                            className="btn btn-ghost"
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <X size={10} /> Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(server)}
                            disabled={saving}
                            className="btn btn-primary"
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <Save size={10} /> {saving ? "Saving..." : "Save"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(server)}
                          className="btn btn-ghost"
                          style={{
                            fontSize: "11px",
                            padding: "3px 8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          title="Edit this server"
                        >
                          <Edit3 size={10} /> Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {loadingContent === key ? (
                    <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
                      Loading...
                    </p>
                  ) : isEditing ? (
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        minHeight: "240px",
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
                      {serverContent[key] ?? ""}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {query ? `No servers matching "${query}".` : "No MCP servers yet. Import agentmemory as personal, or add notes to the repo."}
        </p>
      )}
    </>
  );
}
