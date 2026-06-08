"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { ManagedCatalogList } from "@/components/ManagedCatalogList";
import { McpPanel } from "@/components/McpPanel";
import { OpencodeConfigPanel } from "@/components/OpencodeConfigPanel";
import { PersonaPanel } from "@/components/PersonaPanel";
import { SyncButton } from "@/components/SyncButton";
import { SyncPreviewCard } from "@/components/SyncPreviewCard";
import { AgentLocalFilterBar, SkillSourceFilterBar, SkillUpstreamBanner } from "@/components/SkillCatalogPanels";
import { AsyncListSection, EmptyState } from "@/components";
import { fetchSkillsCatalog, refreshAiToolsCheckout } from "@/lib/skills-client-api";
import {
  fetchAllLocalCandidates,
  fetchManagedRowContent,
  filterManagedRows,
  managedRowsForKind,
} from "@/lib/managed-catalog-client";
import {
  catalogApiBase,
  catalogDisplayPrefix,
  itemKey,
  localContentApiPath,
  sharedCatalogPathLabel,
  type AgentSourceFilter,
  type ManagedKind,
} from "@/lib/managed-catalog-kind";
import { managedCatalogListLoading } from "@/lib/managed-catalog-loading";
import {
  countAgentManagedRows,
  countManagedRowsBySkillSource,
  type AgentListItem,
  type ManagedCatalogRow,
} from "@/lib/managed-catalog-rows";
import type { LocalSkillImportCandidate } from "@/lib/local-skills-types";
import { pruneNameCount, uniquePruneNames } from "@/lib/sync-preview-utils";
import {
  type AiToolsMeta,
  type SkillListItem,
  type SkillSourceFilter,
  type SkillsListResponse,
} from "@/lib/skills-api-types";
import {
  AGENTS_SYNC_EXCLUDE_CHANGED_EVENT,
  AGENTS_SYNC_EXCLUDE_STORAGE_KEY,
  readExcludedAgentIdsFromStorage,
  readExcludedSkillIdsFromStorage,
  SKILLS_SYNC_EXCLUDE_CHANGED_EVENT,
  SKILLS_SYNC_EXCLUDE_STORAGE_KEY,
  writeExcludedAgentIdsToStorage,
  writeExcludedSkillIdsToStorage,
} from "@/lib/skills-sync-exclude-storage";
import type { SyncPreviewResult } from "@/lib/sync-preview-types";
import { useClientMounted } from "@/lib/use-client-mounted";
import { useToast } from "@/lib/use-toast";

type Tab = "skills" | "agents" | "persona" | "mcp" | "opencode";

interface SkillsPageProps {
  initialCatalog?: SkillsListResponse;
}

export default function SkillsPage({ initialCatalog }: SkillsPageProps) {
  return <AgentsLibraryPage initialCatalog={initialCatalog} />;
}

const TAB_IDS: Tab[] = ["skills", "agents", "persona", "mcp", "opencode"];

function tabFromParam(raw: string | null): Tab {
  if (raw && (TAB_IDS as readonly string[]).includes(raw)) return raw as Tab;
  return "skills";
}

function AgentsLibraryPage({ initialCatalog }: { initialCatalog?: SkillsListResponse }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = tabFromParam(searchParams.get("tab"));

  const selectTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "skills") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `/skills?${qs}` : "/skills", { scroll: false });
    },
    [router, searchParams],
  );
  const [skills, setSkills] = useState<SkillListItem[]>(initialCatalog?.skills ?? []);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loading, setLoading] = useState(!initialCatalog);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [excludedSkills, setExcludedSkills] = useState<Record<string, boolean>>({});
  const [excludedAgents, setExcludedAgents] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [syncPruneSkills, setSyncPruneSkills] = useState(false);
  const [syncPruneAgents, setSyncPruneAgents] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [skillSourceFilter, setSkillSourceFilter] = useState<SkillSourceFilter>("all");
  const [aiToolsMeta, setAiToolsMeta] = useState<AiToolsMeta | null>(initialCatalog?.aiTools ?? null);
  const [aiToolsCommit, setAiToolsCommit] = useState<string | null>(null);
  const [refreshingSkills, setRefreshingSkills] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [localSkillCandidates, setLocalSkillCandidates] = useState<LocalSkillImportCandidate[]>([]);
  const [localAgentCandidates, setLocalAgentCandidates] = useState<LocalSkillImportCandidate[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [agentSourceFilter, setAgentSourceFilter] = useState<AgentSourceFilter>("all");
  const [importingName, setImportingName] = useState<string | null>(null);
  const [highlightNames, setHighlightNames] = useState<string[]>([]);
  const catalogListRef = useRef<HTMLDivElement | null>(null);
  const mounted = useClientMounted();
  const toast = useToast();
  const confirm = useConfirm();

  const reloadSkills = useCallback(async () => {
    try {
      const data = await fetchSkillsCatalog();
      setSkills(data.skills);
      setAiToolsMeta(data.aiTools);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load skills.");
    }
  }, [toast]);

  const reloadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const r = await fetch("/api/agents");
      if (!r.ok) throw new Error("Could not load agents.");
      const list = (await r.json()) as AgentListItem[];
      setAgents(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load agents.");
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, [toast]);

  const reloadLocalCandidates = useCallback(async () => {
    await Promise.resolve();
    setLoadingLocal(true);
    try {
      const { skills, agents } = await fetchAllLocalCandidates();
      setLocalSkillCandidates(skills);
      setLocalAgentCandidates(agents);
    } catch {
      toast.error("Could not scan local tool directories.");
      setLocalSkillCandidates([]);
      setLocalAgentCandidates([]);
    } finally {
      setLoadingLocal(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load agents catalog on mount
    void reloadAgents();
  }, [reloadAgents]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- scan local tool dirs on mount
    void reloadLocalCandidates();
  }, [reloadLocalCandidates]);

  useEffect(() => {
    if (initialCatalog) return;
    void fetchSkillsCatalog()
      .then((data) => {
        setSkills(data.skills);
        setAiToolsMeta(data.aiTools);
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Could not load skills.");
      })
      .finally(() => setLoading(false));
  }, [initialCatalog, toast]);

  useEffect(() => {
    const applySkills = () => {
      const next: Record<string, boolean> = {};
      for (const id of readExcludedSkillIdsFromStorage()) next[id] = true;
      setExcludedSkills(next);
    };
    const applyAgents = () => {
      const next: Record<string, boolean> = {};
      for (const id of readExcludedAgentIdsFromStorage()) next[id] = true;
      setExcludedAgents(next);
    };
    applySkills();
    applyAgents();
    window.addEventListener(SKILLS_SYNC_EXCLUDE_CHANGED_EVENT, applySkills);
    window.addEventListener(AGENTS_SYNC_EXCLUDE_CHANGED_EVENT, applyAgents);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === SKILLS_SYNC_EXCLUDE_STORAGE_KEY) applySkills();
      if (ev.key === AGENTS_SYNC_EXCLUDE_STORAGE_KEY) applyAgents();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SKILLS_SYNC_EXCLUDE_CHANGED_EVENT, applySkills);
      window.removeEventListener(AGENTS_SYNC_EXCLUDE_CHANGED_EVENT, applyAgents);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const visibleKind: ManagedKind = tab === "agents" ? "agent" : "skill";

  const managedRows = useMemo(
    () => managedRowsForKind(visibleKind, skills, agents, localSkillCandidates, localAgentCandidates),
    [visibleKind, skills, agents, localSkillCandidates, localAgentCandidates],
  );

  const filteredRows = useMemo(
    () =>
      filterManagedRows(managedRows, visibleKind, {
        skillSourceFilter: visibleKind === "skill" ? skillSourceFilter : undefined,
        agentSourceFilter: visibleKind === "agent" ? agentSourceFilter : undefined,
        highlightNames: highlightNames.length > 0 ? highlightNames : undefined,
        query: highlightNames.length > 0 ? undefined : query,
      }),
    [managedRows, visibleKind, skillSourceFilter, agentSourceFilter, query, highlightNames],
  );

  const skillRows = useMemo(
    () => managedRowsForKind("skill", skills, agents, localSkillCandidates, localAgentCandidates),
    [skills, agents, localSkillCandidates, localAgentCandidates],
  );

  const skillFilterCounts = useMemo(
    () => countManagedRowsBySkillSource(skillRows as ManagedCatalogRow<SkillListItem>[]),
    [skillRows],
  );

  const agentRows = useMemo(
    () => managedRowsForKind("agent", skills, agents, localSkillCandidates, localAgentCandidates),
    [skills, agents, localSkillCandidates, localAgentCandidates],
  );

  const agentFilterCounts = useMemo(() => countAgentManagedRows(agentRows), [agentRows]);

  const catalogListLoading = managedCatalogListLoading(visibleKind, {
    loadingSkills: loading,
    loadingAgents,
    loadingLocal,
    refreshingSkills,
  });

  const loadContentForRow = useCallback(
    async (row: ManagedCatalogRow) => {
      const key = itemKey(visibleKind, row.name);
      if (content[key] && !dirty[key]) return;
      setLoadingContent(key);
      try {
        const text = await fetchManagedRowContent(visibleKind, row);
        setContent((prev) => ({ ...prev, [key]: text }));
      } catch {
        setContent((prev) => ({ ...prev, [key]: "Failed to load." }));
      } finally {
        setLoadingContent(null);
      }
    },
    [visibleKind, content, dirty],
  );
  const excludedMap = visibleKind === "skill" ? excludedSkills : excludedAgents;
  const writeExcluded = visibleKind === "skill" ? writeExcludedSkillIdsToStorage : writeExcludedAgentIdsToStorage;
  const excludeList = Object.entries(excludedMap).filter(([, v]) => v).map(([k]) => k);
  const excludeParam = excludeList.join(",");
  const prune = visibleKind === "skill" ? syncPruneSkills : syncPruneAgents;

  const loadSyncPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        kind: visibleKind,
        prune: String(prune),
      });
      if (excludeParam) params.set("exclude", excludeParam);
      const r = await fetch(`/api/sync-preview?${params.toString()}`);
      if (!r.ok) throw new Error("Preview failed");
      setSyncPreview((await r.json()) as SyncPreviewResult);
    } catch {
      setSyncPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [visibleKind, prune, excludeParam]);

  useEffect(() => {
    if (tab !== "skills" && tab !== "agents") return;
    const id = window.setTimeout(() => {
      void loadSyncPreview();
    }, 0);
    return () => window.clearTimeout(id);
  }, [tab, loadSyncPreview]);

  const toggleRow = useCallback(
    async (row: ManagedCatalogRow) => {
      const key = itemKey(visibleKind, row.name);
      if (expanded === key) {
        setExpanded(null);
        if (editing === key) setEditing(null);
        return;
      }
      setExpanded(key);
      if (editing && editing !== key) setEditing(null);
      await loadContentForRow(row);
    },
    [visibleKind, expanded, editing, loadContentForRow],
  );

  const handleImported = useCallback(() => {
    if (visibleKind === "skill") void reloadSkills();
    else void reloadAgents();
    void reloadLocalCandidates();
    void loadSyncPreview();
  }, [visibleKind, reloadSkills, reloadAgents, reloadLocalCandidates, loadSyncPreview]);

  const showPrunableInList = useCallback(
    (names: string[]) => {
      if (visibleKind === "skill") setSkillSourceFilter("local");
      else setAgentSourceFilter("local");
      setHighlightNames(names);
      setQuery("");
      catalogListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [visibleKind],
  );

  const pruneWarningCount = useMemo(
    () => pruneNameCount(syncPreview, visibleKind, prune),
    [syncPreview, visibleKind, prune],
  );

  const saveEdit = useCallback(async (kind: ManagedKind, name: string) => {
    const key = itemKey(kind, name);
    setSaving(true);
    try {
      const r = await fetch(`${catalogApiBase(kind)}/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!r.ok) throw new Error("Save failed");
      setContent((prev) => ({ ...prev, [key]: editContent }));
      setDirty((prev) => ({ ...prev, [key]: false }));
      setEditing(null);
      toast.success(`Saved ${catalogDisplayPrefix(kind)}${name}.`);
      void loadSyncPreview();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }, [editContent, loadSyncPreview, toast]);

  const deleteItem = useCallback(async (kind: ManagedKind, row: ManagedCatalogRow) => {
    const name = row.name;
    const isLocalOnly = row.kind === "local-only";
    const localTools = isLocalOnly
      ? [...new Set(row.candidate.sources.map((s) => s.tool))].join(", ")
      : "";
    const ok = await confirm({
      title: `Delete this ${kind}?`,
      message: isLocalOnly
        ? `This permanently removes ${name} from your local tool directories (${localTools}). The shared catalog is unchanged.`
        : `This permanently removes ${catalogDisplayPrefix(kind)}${name} from ${sharedCatalogPathLabel(kind)}. Sync with prune when you want local tool copies removed too.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const key = itemKey(kind, name);
    setDeleting(key);
    try {
      const url = isLocalOnly
        ? localContentApiPath(kind, name)
        : `${catalogApiBase(kind)}/${encodeURIComponent(name)}`;
      const r = await fetch(url, { method: "DELETE" });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? (await r.text()));
      }
      if (!isLocalOnly) {
        if (kind === "skill") setSkills((prev) => prev.filter((item) => item.name !== name));
        else setAgents((prev) => prev.filter((item) => item.name !== name));
        void loadSyncPreview();
      }
      if (expanded === key) setExpanded(null);
      if (editing === key) setEditing(null);
      setContent((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success(
        isLocalOnly
          ? `Removed local ${kind} ${name}.`
          : `Deleted ${catalogDisplayPrefix(kind)}${name}.`,
      );
      void reloadLocalCandidates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn't delete ${kind}.`);
    } finally {
      setDeleting(null);
    }
  }, [confirm, toast, expanded, editing, loadSyncPreview, reloadLocalCandidates]);

  const handleRename = useCallback(async (kind: ManagedKind, oldName: string) => {
    const raw = renameValue.trim().toLowerCase();
    if (!raw || raw === oldName) {
      setRenamingKey(null);
      return;
    }
    try {
      const r = await fetch(`${catalogApiBase(kind)}/${oldName}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: raw }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Rename failed");
      const oldKey = itemKey(kind, oldName);
      const newKey = itemKey(kind, data.name);
      if (kind === "skill") {
        setSkills((prev) => prev.map((item) => item.name === oldName ? { ...item, name: data.name } : item));
      } else {
        setAgents((prev) => prev.map((item) => item.name === oldName ? { ...item, name: data.name } : item));
      }
      if (expanded === oldKey) setExpanded(newKey);
      if (editing === oldKey) setEditing(newKey);
      setContent((prev) => {
        const next = { ...prev };
        if (next[oldKey] !== undefined) { next[newKey] = next[oldKey]; delete next[oldKey]; }
        return next;
      });
      setDirty((prev) => {
        const next = { ...prev };
        if (next[oldKey] !== undefined) { next[newKey] = next[oldKey]; delete next[oldKey]; }
        return next;
      });
      setRenamingKey(null);
      toast.success(`Renamed to ${catalogDisplayPrefix(kind)}${data.name}.`);
      void loadSyncPreview();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed.");
    }
  }, [renameValue, expanded, editing, loadSyncPreview, toast]);

  const createItem = useCallback(async () => {
    const slug = newName.trim().toLowerCase();
    if (!slug) {
      toast.error(`Enter a ${visibleKind} name.`);
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(catalogApiBase(visibleKind), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug, description: newDesc.trim() || undefined }),
      });
      const data = (await r.json()) as { error?: string; name?: string };
      if (!r.ok) throw new Error(data.error ?? "Create failed");
      toast.success(`Created ${catalogDisplayPrefix(visibleKind)}${data.name}.`);
      setShowNew(false);
      setNewName("");
      setNewDesc("");
      if (visibleKind === "skill") await reloadSkills();
      else await reloadAgents();
      await reloadLocalCandidates();
      await loadSyncPreview();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not create ${visibleKind}.`);
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, visibleKind, toast, reloadSkills, reloadAgents, reloadLocalCandidates, loadSyncPreview]);

  const refreshSkills = useCallback(async (opts?: { silent?: boolean }) => {
    setRefreshingSkills(true);
    try {
      const data = await refreshAiToolsCheckout();
      if (data.commit) setAiToolsCommit(data.commit);
      await reloadSkills();
      await loadSyncPreview();

      if (data.disabled) {
        if (!opts?.silent) {
          toast.success("Skills catalog refreshed (ai-tools upstream disabled).");
        }
        return;
      }
      if (data.ok) {
        if (!opts?.silent) {
          toast.success(
            `Skills refreshed${data.commit ? ` (ai-tools @ ${data.commit})` : ""}.`,
          );
        }
        return;
      }
      toast.error(data.warning ?? "Upstream fetch had issues; showing last known catalog.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh skills.");
    } finally {
      setRefreshingSkills(false);
    }
  }, [toast, reloadSkills, loadSyncPreview]);

  const upstreamRefreshStarted = useRef(false);
  useEffect(() => {
    if (tab !== "skills") return;
    if (upstreamRefreshStarted.current) return;
    if (!aiToolsMeta?.syncEnabled || !aiToolsMeta.available) return;
    upstreamRefreshStarted.current = true;
    const id = window.setTimeout(() => {
      void refreshSkills({ silent: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [tab, aiToolsMeta?.syncEnabled, aiToolsMeta?.available, refreshSkills]);

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="page-title">Agents</div>
        {(tab === "skills" || tab === "agents") && (
          <span className="badge badge-muted" suppressHydrationWarning>
            {mounted ? filteredRows.length : "–"}
          </span>
        )}
      </div>

      <div className="hub-tabs" role="tablist" aria-label="Agents sections" style={{ marginBottom: "16px" }}>
        {([
          ["skills", "Skills"],
          ["agents", "Agents"],
          ["persona", "Persona"],
          ["mcp", "MCP servers"],
          ["opencode", "OpenCode"],
        ] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`hub-tab ${tab === id ? "active" : ""}`} onClick={() => selectTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "persona" && <PersonaPanel />}
      {tab === "mcp" && <McpPanel />}
      {tab === "opencode" && <OpencodeConfigPanel />}

      {(tab === "skills" || tab === "agents") && (
        <>
          <ul
            className="text-xs"
            style={{ color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "12px", paddingLeft: "18px" }}
          >
            <li>
              <strong style={{ color: "var(--text)" }}>Catalog</strong> —{" "}
              {visibleKind === "skill" ? (
                <>
                  <code>skills/shared/</code> plus read-only <code>ai-tools</code> upstream.
                </>
              ) : (
                <code>agents/shared/</code>
              )}{" "}
              Rows with <strong>Add to catalog</strong> exist only on your machine; import them to share via git.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Local tools</strong> — sync pushes the catalog to install dirs.
              Prune removes extras not in the catalog. Use the eye icon to exclude catalog entries from sync/prune.
            </li>
          </ul>

          {visibleKind === "skill" && (
            <SkillUpstreamBanner
              aiTools={aiToolsMeta}
              lastCommit={aiToolsCommit}
              refreshing={refreshingSkills}
            />
          )}

          <div className="mb-3">
            <div className="text-xs font-semibold mb-1" style={{ color: "var(--text)" }}>
              Push to local tools
            </div>
            <div className="text-xs mb-2" style={{ color: "var(--text-subtle)" }}>
              Catalog → local tool dirs. Existing matching names are overwritten from the catalog.
            </div>
            <label className="flex items-start gap-2 text-xs mb-2 cursor-pointer" style={{ color: "var(--text-muted)", lineHeight: 1.45 }}>
              <input type="checkbox" className="mt-0.5" checked={visibleKind === "skill" ? syncPruneSkills : syncPruneAgents} onChange={(e) => visibleKind === "skill" ? setSyncPruneSkills(e.target.checked) : setSyncPruneAgents(e.target.checked)} />
              <span>
                <strong style={{ color: "var(--text)" }}>Prune extras</strong> during sync. Off by default; when enabled,
                tool-dir entries not in the catalog are removed.
              </span>
            </label>

            <SyncPreviewCard
              preview={syncPreview?.kind === visibleKind ? syncPreview : null}
              loading={loadingPreview || (!!syncPreview && syncPreview.kind !== visibleKind)}
              onRefresh={() => void loadSyncPreview()}
              onShowPrunableInList={showPrunableInList}
            />
          </div>

          {pruneWarningCount > 0 && (
            <div
              className="card mb-3 text-xs"
              style={{
                padding: "10px 14px",
                borderColor: "var(--danger)",
                color: "var(--danger)",
                lineHeight: 1.45,
              }}
            >
              Prune will remove {pruneWarningCount} local {visibleKind}
              {pruneWarningCount === 1 ? "" : "s"} not in the catalog. Add them to the catalog first, or turn off prune.
              <button
                type="button"
                className="btn btn-ghost text-xs ml-2"
                style={{ color: "inherit" }}
                onClick={() => syncPreview && showPrunableInList(uniquePruneNames(syncPreview))}
              >
                Show in list
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {visibleKind === "skill" ? (
              <SkillSourceFilterBar
                counts={skillFilterCounts}
                filter={skillSourceFilter}
                onFilterChange={(f) => {
                  setSkillSourceFilter(f);
                  setHighlightNames([]);
                }}
                loading={catalogListLoading}
              />
            ) : (
              <AgentLocalFilterBar
                counts={agentFilterCounts}
                filter={agentSourceFilter}
                onFilterChange={(f) => {
                  setAgentSourceFilter(f);
                  setHighlightNames([]);
                }}
                loading={catalogListLoading}
              />
            )}
            <input
              className="input"
              placeholder={`Filter ${visibleKind}s...`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightNames([]);
              }}
              style={{ flex: "1 1 160px", minWidth: "140px" }}
            />
            <button type="button" className="btn btn-ghost text-xs" style={{ display: "flex", alignItems: "center", gap: "4px" }} onClick={() => setShowNew(true)}>
              <Plus size={12} aria-hidden /> New {visibleKind}
            </button>
            <SyncButton
              script={visibleKind === "skill" ? "sync_skills" : "sync_agents"}
              label={`Sync ${visibleKind}s`}
              excludeSkills={visibleKind === "skill" && excludeList.length ? excludeList : undefined}
              excludeAgents={visibleKind === "agent" && excludeList.length ? excludeList : undefined}
              prune={visibleKind === "skill" ? syncPruneSkills : syncPruneAgents}
              successMessage={`${visibleKind === "skill" ? "Skills" : "Agents"} synced from repo${(visibleKind === "skill" ? syncPruneSkills : syncPruneAgents) ? "; extras pruned where applicable" : ""}.`}
              onComplete={() => {
                void loadSyncPreview();
                void reloadLocalCandidates();
              }}
            />
          </div>

          {showNew && (
            <div className="card mb-3" style={{ padding: "12px 14px", borderColor: "var(--accent)", borderWidth: "1px" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "var(--text)" }}>New shared {visibleKind}</div>
              <div className="flex flex-col gap-2">
                <input className="input font-mono text-xs" placeholder={`${visibleKind}-id`} value={newName} onChange={(e) => setNewName(e.target.value)} spellCheck={false} />
                <input className="input text-xs" placeholder="Short description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => setShowNew(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary text-xs" disabled={creating || !newName.trim()} onClick={() => void createItem()}>{creating ? "Creating..." : "Create"}</button>
                </div>
              </div>
            </div>
          )}

          <AsyncListSection
            loading={catalogListLoading}
            isEmpty={filteredRows.length === 0}
            empty={
              <EmptyState
                title={
                  highlightNames.length > 0
                    ? `No ${visibleKind}s in this prune set are waiting to be added to the catalog.`
                    : query
                      ? `No ${visibleKind}s matching "${query}".`
                      : `No ${visibleKind}s found.`
                }
              />
            }
          >
            <ManagedCatalogList
              kind={visibleKind}
              rows={filteredRows}
              listRef={catalogListRef}
              expanded={expanded}
              editing={editing}
              content={content}
              loadingContent={loadingContent}
              dirty={dirty}
              editContent={editContent}
              setEditContent={setEditContent}
              setDirty={setDirty}
              excludedMap={excludedMap}
              deleting={deleting}
              renamingKey={renamingKey}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              setExpanded={setExpanded}
              setEditing={setEditing}
              importingName={importingName}
              setImportingName={setImportingName}
              onImported={handleImported}
              onToggleRow={toggleRow}
              onSaveEdit={(name) => saveEdit(visibleKind, name)}
              onDelete={(row) => deleteItem(visibleKind, row)}
              onRename={(oldName) => handleRename(visibleKind, oldName)}
              onExcludeToggle={(name) => {
                const next = { ...excludedMap, [name]: !excludedMap[name] };
                writeExcluded(Object.entries(next).filter(([, v]) => v).map(([k]) => k));
              }}
              setRenamingKey={setRenamingKey}
              saving={saving}
            />
          </AsyncListSection>
        </>
      )}
    </div>
  );
}
