"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  History,
  Layers,
  Play,
  Table2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { useStoredChoice } from "@/lib/hooks/use-stored-state";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { SearchInput } from "@/components/ui/SearchInput";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { DbObjectSummary } from "@/lib/db/introspect-types";
import { ConnectionRail } from "./ConnectionRail";
import { ResultGrid, type GridSort } from "./ResultGrid";
import { SqlEditor, toCompletionSchema } from "./SqlEditor";
import { StructurePanel } from "./StructurePanel";
import { AddConnectionDialog, type EditableDbConnection } from "./AddConnectionDialog";
import { AiSqlBar } from "./AiSqlBar";
import { EditBar } from "./EditBar";
import { useRowEdits } from "./useRowEdits";
import { objectMenuGroups, quoteIdent } from "./menus";
import type { DbConnectionRow } from "./shared";
import {
  dbApi,
  downloadDbExport,
  fetchDbJson,
  formatDuration,
  formatRowCount,
  kindBadgeClass,
  postDbAction,
  type DbConnectionsPayload,
  type DbHistoryRow,
  type DbPreflightPayload,
  type DbQueryPlan,
  type DbQueryResult,
  type DbSchemaPayload,
  type DbTabId,
  type DbTablePayload,
} from "./shared";

const TABS: readonly [DbTabId, string, LucideIcon][] = [
  ["data", "Data", Table2],
  ["structure", "Structure", Layers],
  ["query", "Query", Play],
  ["history", "History", History],
];

const TAB_IDS: readonly DbTabId[] = TABS.map(([id]) => id);

/**
 * The database workspace.
 *
 * Shaped like `RepoGitWorkspace`: a rail of things you can open, a tabbed pane
 * over the one you did. What differs is that opening a connection is a network
 * operation that can fail for reasons outside the database — so the empty state
 * for a failed connect is a *preflight*, not an error toast. "Tailscale is not
 * running" is a fixable answer; "connect ETIMEDOUT" is not.
 *
 * Fetching goes through `useLive` rather than hand-rolled effects. Beyond being
 * the house convention, it pauses in hidden workspace tabs — a keep-alive tab
 * left on a prd connection should not keep re-listing its schema all afternoon.
 */
export function DbWorkspace() {
  const toast = useToast();
  const confirm = useConfirm();
  const runSequence = useRef(0);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useStoredChoice<DbTabId>("devhub:db:tab", "data", TAB_IDS);
  const [addOpen, setAddOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<EditableDbConnection | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const [objectFilter, setObjectFilter] = useState("");
  const [selectedObject, setSelectedObject] = useState<{ namespace: string; name: string } | null>(
    null,
  );

  const [statement, setStatement] = useState("");
  const [plan, setPlan] = useState<DbQueryPlan | null>(null);
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [confirmLabel, setConfirmLabel] = useState("");
  const [preflight, setPreflight] = useState<DbPreflightPayload | null>(null);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [remedyPendingId, setRemedyPendingId] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [aiSeed, setAiSeed] = useState<string | undefined>(undefined);
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    groups: ContextMenuGroup[];
  } | null>(null);

  /* ─── Data ─── */

  const connectionsQuery = useLive<DbConnectionsPayload>("/api/db/connections");
  // Memoised so the fallback object is not a fresh identity on every render,
  // which would invalidate everything downstream that depends on it.
  const connections = useMemo<DbConnectionsPayload>(
    () => connectionsQuery.data ?? { connections: [], errors: [] },
    [connectionsQuery.data],
  );

  const active = useMemo(
    () => connections.connections.find((c) => c.id === activeId) ?? null,
    [connections, activeId],
  );

  const schemaQuery = useLive<DbSchemaPayload>(activeId ? dbApi(activeId, "/schema") : null, {
    // A schema does not change under you the way a working tree does, and
    // re-listing it every minute against prd is traffic for nothing.
    refreshInterval: 0,
    shouldRetryOnError: false,
  });

  const detailQuery = useLive<DbTablePayload>(
    activeId && selectedObject
      ? `${dbApi(activeId, "/table")}?namespace=${encodeURIComponent(
          selectedObject.namespace,
        )}&name=${encodeURIComponent(selectedObject.name)}`
      : null,
    { refreshInterval: 0, shouldRetryOnError: false },
  );

  const historyQuery = useLive<{ entries: DbHistoryRow[] }>(
    tab === "history" ? "/api/db/history?limit=100" : null,
    { refreshInterval: 0 },
  );

  /**
   * Schemas, tables and every column, for the editor's autocomplete.
   *
   * Fetched separately from `/schema` and only once a connection is open: it is
   * one query but a much larger payload, and the schema tree should not wait on
   * columns it never renders.
   */
  const completions = useLive<{
    schemas: string[];
    tables: Record<string, string[]>;
    defaultSchema?: string;
  }>(activeId ? dbApi(activeId, "/completions") : null, {
    refreshInterval: 0,
    shouldRetryOnError: false,
  });

  /**
   * When the schema fails to load, ask why.
   *
   * The failure is nearly always the machine rather than the database — an
   * expired profile, a down tailnet — and the preflight is what turns
   * "ETIMEDOUT" into something the user can fix.
   */
  useEffect(() => {
    if (!activeId || !schemaQuery.error) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchDbJson<DbPreflightPayload>(dbApi(activeId, "/preflight"));
        if (!cancelled) setPreflight(data);
      } catch {
        // A courtesy; its failure must not replace the real error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, schemaQuery.error]);

  /* ─── Actions ─── */

  const selectConnection = useCallback(
    (id: string) => {
      runSequence.current += 1;
      setActiveId(id);
      // Everything below the connection belongs to the old one.
      setSelectedObject(null);
      setResult(null);
      setRunError(null);
      setPreflight(null);
      setConfirmLabel("");
      setStatement("");
      setRunning(false);
    },
    [],
  );

  const refreshConnections = useCallback(async () => {
    setRefreshing(true);
    try {
      await connectionsQuery.mutate(
        fetchDbJson<DbConnectionsPayload>("/api/db/connections?refresh=true"),
        { revalidate: false },
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [connectionsQuery, toast]);

  const run = useCallback(
    async (sql: string) => {
      if (!activeId || !sql.trim()) return;
      const runId = ++runSequence.current;
      setRunning(true);
      setRunError(null);

      const response = await postDbAction<DbQueryResult>(dbApi(activeId, "/query"), {
        statement: sql,
        confirm: confirmLabel || undefined,
      });

      if (runId !== runSequence.current) return;
      setRunning(false);

      if (response.ok) {
        setResult(response.json);
        setConfirmLabel("");
        void historyQuery.mutate();
        return;
      }

      setRunError(response.message);
      // A confirmation failure is a prompt, not an error to dismiss — the field
      // it wants is rendered below the message.
      if (response.kind === "unavailable") {
        try {
          setPreflight(await fetchDbJson<DbPreflightPayload>(dbApi(activeId, "/preflight")));
        } catch {
          // Best effort.
        }
      }
    },
    [activeId, confirmLabel, historyQuery],
  );

  /**
   * Classify as the user types, so Run can explain itself before it is pressed.
   *
   * The effect only ever sets state from the response. Clearing a stale plan for
   * an empty buffer is derived below instead — an effect whose job is to
   * immediately setState is the cascading-render pattern the lint rule exists
   * to catch, and here it was never necessary.
   */
  useEffect(() => {
    const trimmed = statement.trim();
    if (!activeId || !trimmed) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const response = await postDbAction<DbQueryPlan>(dbApi(activeId, "/query"), {
          statement,
          planOnly: true,
        });
        if (!cancelled) setPlan(response.ok ? response.json : null);
      })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId, statement]);

  const cancel = useCallback(async () => {
    if (!activeId) return;
    const response = await postDbAction<{ cancelled: boolean }>(dbApi(activeId, "/cancel"), {});
    if (response.ok) {
      toast[response.json.cancelled ? "success" : "info"](
        response.json.cancelled
          ? "Cancelled."
          : "Nothing was running, or this engine cannot cancel.",
      );
    }
  }, [activeId, toast]);

  /** Open a table: preview its rows and select it for Structure. */
  const openObject = useCallback(
    (namespace: string, name: string) => {
      setSelectedObject({ namespace, name });
      setSort(null);
      if (!active) return;
      const preview =
        active.engine === "mongodb"
          ? `db.${name}.find({}).limit(200)`
          : `SELECT * FROM ${quoteFor(active.engine, namespace, name)} LIMIT 200;`;
      setStatement(preview);
      setTab("data");
      void run(preview);
    },
    [active, run, setTab],
  );

  /**
   * Sort by re-running with an ORDER BY, not by sorting the rows in hand.
   *
   * Sorting the page would order the 200 rows that happened to come back, which
   * on a million-row table is a different answer from the one the header
   * promises. Rewriting the statement is the only version that is true.
   */
  const applySort = useCallback(
    (next: GridSort) => {
      if (!active || !selectedObject) return;
      setSort(next);
      const target = quoteFor(active.engine, selectedObject.namespace, selectedObject.name);
      const sql =
        active.engine === "mongodb"
          ? `db.${selectedObject.name}.find({}).sort({ ${JSON.stringify(next.column)}: ${
              next.direction === "asc" ? 1 : -1
            } }).limit(200)`
          : `SELECT * FROM ${target} ORDER BY ${quoteIdent(next.column)} ${
              next.direction === "asc" ? "ASC" : "DESC"
            } LIMIT 200;`;
      setStatement(sql);
      void run(sql);
    },
    [active, selectedObject, run],
  );

  /** A context-menu filter rewrites the current preview rather than appending blindly. */
  const applyFilter = useCallback(
    (clause: string) => {
      if (!active || !selectedObject) return;
      const sql =
        active.engine === "mongodb"
          ? `db.${selectedObject.name}.find(${clause}).limit(200)`
          : `SELECT * FROM ${quoteFor(
              active.engine,
              selectedObject.namespace,
              selectedObject.name,
            )}\nWHERE ${clause}\nLIMIT 200;`;
      setStatement(sql);
      void run(sql);
    },
    [active, selectedObject, run],
  );

  const copy = useCallback(
    async (text: string, what: string) => {
      await copyTextToClipboard(text);
      toast.success(`${what} copied`);
    },
    [toast],
  );

  /**
   * Apply a provider's remedy — for BI, switching AWS profile.
   *
   * The connection list is derived from access, so once the access changes the
   * list and every pooled socket are stale. Resetting both is what makes the
   * button leave you somewhere usable rather than somewhere confusing.
   */
  const applyRemedy = useCallback(
    async (connection: DbConnectionRow) => {
      if (!connection.remedy) return;
      setRemedyPendingId(connection.id);
      const response = await postDbAction(connection.remedy.endpoint, connection.remedy.body ?? {});
      setRemedyPendingId(null);

      if (!response.ok) {
        toast.error(response.message);
        return;
      }
      await postDbAction("/api/db/connections", {});
      await connectionsQuery.mutate();
      toast.success(`${connection.remedy.label} — done`);
    },
    [connectionsQuery, toast],
  );

  /**
   * Apply a preflight fix, then get on with it.
   *
   * The reconnect is the whole feature. Fixing the thing and leaving the user
   * on the same error panel would be a diagnosis with extra steps — what they
   * asked for was to click the database and use it.
   */
  const applyFix = useCallback(
    async (remedy: NonNullable<DbPreflightPayload["checks"][number]["remedy"]>) => {
      setFixingId(remedy.id);
      const response = await postDbAction(remedy.endpoint, remedy.body ?? {});
      setFixingId(null);

      if (!response.ok) {
        toast.error(response.message);
        // Re-read the preflight either way: a failed fix often changes *which*
        // check is now the blocker.
        if (activeId) {
          try {
            setPreflight(await fetchDbJson<DbPreflightPayload>(dbApi(activeId, "/preflight")));
          } catch {
            /* keep the panel as it is */
          }
        }
        return;
      }

      toast.success(`${remedy.label} — done`);

      // The connection list is derived from access, so a profile switch makes
      // it stale; pooled sockets are authenticated as somebody else.
      if (remedy.affectsMachineState) {
        await postDbAction("/api/db/connections", {});
        await connectionsQuery.mutate();
      }

      setPreflight(null);
      await schemaQuery.mutate();
    },
    [activeId, connectionsQuery, schemaQuery, toast],
  );

  const disconnect = useCallback(
    async (id: string) => {
      await postDbAction(dbApi(id, "/cancel"), {}, { method: "DELETE" });
      await connectionsQuery.mutate();
      toast.success("Disconnected");
    },
    [connectionsQuery, toast],
  );

  const editConnection = useCallback(
    async (connection: DbConnectionRow) => {
      try {
        const data = await fetchDbJson<{ connections: EditableDbConnection[] }>(
          "/api/db/connections/manage",
        );
        const slug = connection.id.slice("local:".length);
        const stored = data.connections.find((candidate) => candidate.slug === slug);
        if (!stored) {
          toast.error("That saved connection no longer exists.");
          return;
        }
        setEditingConnection(stored);
        setAddOpen(true);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [toast],
  );

  const deleteConnection = useCallback(
    async (connection: DbConnectionRow) => {
      const ok = await confirm({
        title: `Remove ${connection.label}?`,
        message: "This removes the saved connection from DevHub. It does not change or delete the database.",
        confirmLabel: "Remove connection",
        variant: "danger",
      });
      if (!ok) return;

      const slug = connection.id.slice("local:".length);
      const response = await postDbAction(
        `/api/db/connections/manage?slug=${encodeURIComponent(slug)}`,
        {},
        { method: "DELETE" },
      );
      if (!response.ok) {
        toast.error(response.message);
        return;
      }
      if (activeId === connection.id) {
        runSequence.current += 1;
        setActiveId(null);
        setRunning(false);
        setResult(null);
        setSelectedObject(null);
      }
      await connectionsQuery.mutate();
      toast.success(`${connection.label} removed`);
    },
    [activeId, confirm, connectionsQuery, toast],
  );

  const menuActions = useMemo(
    () => ({
      onDisconnect: (id: string) => void disconnect(id),
      onRemedy: (connection: DbConnectionRow) => void applyRemedy(connection),
      onEdit: (connection: DbConnectionRow) => void editConnection(connection),
      onDelete: (connection: DbConnectionRow) => void deleteConnection(connection),
      notify: (message: string) => toast.success(message),
    }),
    [disconnect, applyRemedy, editConnection, deleteConnection, toast],
  );

  const objectMenuFor = useCallback(
    (object: DbObjectSummary) =>
      objectMenuGroups(object, active?.engine ?? "postgres", {
        onRun: (sql) => {
          // Select the table as well as running the query. Without this the
          // grid has rows but no idea which table they came from, which
          // silently disables "Copy row as INSERT", sorting and the identity
          // note — all of which need a table, not just a result set.
          setSelectedObject({ namespace: object.namespace, name: object.name });
          setSort(null);
          setStatement(sql);
          setTab("data");
          void run(sql);
        },
        onInsertIntoEditor: (sql) => {
          setStatement(sql);
          setTab("query");
        },
        onStructure: (o) => {
          setSelectedObject({ namespace: o.namespace, name: o.name });
          setTab("structure");
        },
        onExport: (o) => {
          void downloadDbExport(active?.id ?? "", {
            statement: `SELECT * FROM ${quoteFor(
              active?.engine ?? "postgres",
              o.namespace,
              o.name,
            )} LIMIT 10000;`,
            format: "csv",
            name: o.name,
          });
        },
        notify: (message) => toast.success(message),
        canWrite: active?.accessMode === "write",
      }),
    [active, run, setTab, toast],
  );

  /* ─── Derived ─── */

  const schema = schemaQuery.data ?? null;

  const objects = useMemo(() => {
    if (!schema) return [];
    const needle = objectFilter.trim().toLowerCase();
    return needle
      ? schema.objects.filter((o) => o.name.toLowerCase().includes(needle))
      : schema.objects;
  }, [schema, objectFilter]);

  const completionSchema = useMemo(
    () => (completions.data ? toCompletionSchema(completions.data.tables, completions.data.defaultSchema) : {}),
    [completions.data],
  );

  const detail = detailQuery.data ?? null;
  const lastResult = result?.results.at(-1);
  const schemaError = schemaQuery.error ? (schemaQuery.error as Error).message : null;

  /**
   * A plan belongs to the text that produced it.
   *
   * Derived rather than cleared in an effect: an empty buffer has no plan by
   * definition, and holding the last one would leave a stale "write" badge
   * beside an empty editor.
   */
  const activePlan = statement.trim() ? plan : null;

  /**
   * Staged grid edits for the result in view.
   *
   * Keyed to the current result, so re-running the query is also how you
   * discard — a buffer that survived a refetch would point at row indexes that
   * no longer mean anything.
   */
  const rowEdits = useRowEdits(lastResult, detail?.identity ?? null);
  const editable = Boolean(detail?.editable) && !rowEdits.blocked && tab === "data";

  return (
    <div className="db-workspace">
      <ConnectionRail
        connections={connections.connections}
        errors={connections.errors}
        loading={connectionsQuery.isLoading}
        error={connectionsQuery.error ? (connectionsQuery.error as Error).message : null}
        activeId={activeId}
        onSelect={selectConnection}
        onRefresh={() => void refreshConnections()}
        onAdd={() => {
          setEditingConnection(undefined);
          setAddOpen(true);
        }}
        refreshing={refreshing}
        menuActions={menuActions}
        remedyPendingId={remedyPendingId}
      />

      <div className="db-main">
        {!active && (
          <div className="db-main-empty">
            <EmptyState
              title="Pick a connection"
              subtitle="Local SQLite files need no setup. BI databases appear once an AWS profile is active in Ops."
            />
          </div>
        )}

        {active && (
          <>
            <header className="db-header">
              <div className="db-header-title">
                <h1>{active.label}</h1>
                <span className="badge badge-muted">{active.engine}</span>
                {active.dangerous && (
                  <span className="badge badge-danger">
                    <AlertTriangle size={11} aria-hidden /> production
                  </span>
                )}
                {active.accessMode === "read" && (
                  <span className="badge badge-muted">read-only</span>
                )}
              </div>

              <nav className="db-tabs" aria-label="Database views">
                {TABS.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    className={`db-tab${tab === id ? " is-active" : ""}`}
                    onClick={() => setTab(id)}
                    aria-current={tab === id}
                  >
                    <Icon size={13} aria-hidden />
                    {label}
                  </button>
                ))}
              </nav>
            </header>

            <div className="db-body">
              {tab !== "history" && (
                <aside className="db-tree">
                  <SearchInput
                    value={objectFilter}
                    onChange={setObjectFilter}
                    placeholder="Filter tables"
                    wrapperClassName="db-tree-search"
                  />
                  {schemaQuery.isLoading && <SkeletonRows count={8} height={26} variant="list" />}
                  {!schemaQuery.isLoading && schemaError && (
                    <ConnectionProblem
                      message={schemaError}
                      preflight={preflight}
                      onRetry={() => void schemaQuery.mutate()}
                      onFix={(remedy) => void applyFix(remedy)}
                      fixingId={fixingId}
                    />
                  )}
                   {!schemaQuery.isLoading && !schemaError && objects.length === 0 && (
                    <EmptyState
                      title={objectFilter.trim() ? "No matches" : "Nothing here"}
                      subtitle={
                        objectFilter.trim()
                          ? `Nothing matches “${objectFilter.trim()}”.`
                          : "No tables or collections."
                      }
                      bare
                    />
                  )}
                  <ul className="db-tree-list">
                    {objects.map((object) => (
                      <li key={`${object.namespace}.${object.name}`}>
                        <button
                          type="button"
                          className={`db-tree-row${
                            selectedObject?.name === object.name &&
                            selectedObject?.namespace === object.namespace
                              ? " is-active"
                              : ""
                          }`}
                          onClick={() => openObject(object.namespace, object.name)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setTreeMenu({
                              x: e.clientX,
                              y: e.clientY,
                              groups: objectMenuFor(object),
                            });
                          }}
                        >
                          <span className="db-tree-name">{object.name}</span>
                          {object.kind !== "table" && object.kind !== "collection" && (
                            <span className="badge badge-muted">{object.kind}</span>
                          )}
                          {object.estimatedRows !== undefined && (
                            <span className="db-tree-count">
                              {formatRowCount(object.estimatedRows)}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
              )}

              <section className="db-pane">
                {tab === "structure" &&
                  (detail ? (
                    <StructurePanel detail={detail} />
                  ) : detailQuery.isLoading ? (
                    <SkeletonRows count={6} height={30} />
                  ) : (
                    <EmptyState
                      title="No table selected"
                      subtitle="Pick a table to see its columns, indexes and DDL."
                      bare
                    />
                  ))}

                {tab === "history" && (
                  historyQuery.isLoading ? (
                    <SkeletonRows count={7} height={32} variant="list" />
                  ) : historyQuery.error ? (
                    <FetchError
                      message={(historyQuery.error as Error).message}
                      onRetry={() => void historyQuery.mutate()}
                      bare
                    />
                  ) : (
                    <HistoryList
                      entries={historyQuery.data?.entries ?? []}
                      onPick={(sql) => {
                        setStatement(sql);
                        setTab("query");
                      }}
                    />
                  )
                )}

                {(tab === "data" || tab === "query") && (
                  <div className="db-query-pane">
                    {tab === "query" && (
                      <div className="db-editor-shell">
                        <SqlEditor
                          value={statement}
                          onChange={setStatement}
                          onRun={(sql) => void run(sql)}
                          engine={active.engine}
                          schema={completionSchema}
                          schemas={completions.data?.schemas}
                          defaultSchema={completions.data?.defaultSchema}
                          canWrite={active.accessMode === "write"}
                          placeholder={
                            active.engine === "mongodb"
                              ? 'db.collection.find({ field: "value" }).limit(50)'
                              : "SELECT * FROM table LIMIT 100;"
                          }
                        />
                        <div className="db-run-bar">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void run(statement)}
                            disabled={running || !statement.trim() || Boolean(activePlan?.refusal)}
                          >
                            {running ? "Running…" : "Run"}
                            <kbd>⌘↵</kbd>
                          </button>
                          {running && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void cancel()}
                            >
                              <X size={13} aria-hidden /> Cancel
                            </button>
                          )}
                          {activePlan && (
                            <span className={kindBadgeClass(activePlan.kind)}>
                              {activePlan.kind}
                              {activePlan.statements.length > 1 && ` ×${activePlan.statements.length}`}
                            </span>
                          )}
                          {lastResult && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                void downloadDbExport(active.id, {
                                  statement,
                                  format: "csv",
                                  name: selectedObject?.name,
                                })
                              }
                            >
                              <Download size={13} aria-hidden /> CSV
                            </button>
                          )}
                        </div>

                        {activePlan?.refusal && (
                          <p className="tone-panel tone-panel--warning db-run-note">
                            {activePlan.refusal.message}
                          </p>
                        )}
                        {activePlan?.needsConfirmation && !activePlan.refusal && (
                          <div className="tone-panel tone-panel--danger db-run-note">
                            <p>
                              This is a <strong>{activePlan.kind}</strong> against production. Type{" "}
                              <code>{active.label}</code> to enable it.
                            </p>
                            <input
                              className="input"
                              value={confirmLabel}
                              onChange={(e) => setConfirmLabel(e.target.value)}
                              placeholder={active.label}
                              aria-label="Type the connection name to confirm"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Available on both tabs: on Data it is how you get from a
                        table you are staring at to the query you actually want. */}
                    <AiSqlBar
                      connectionId={active.id}
                      statement={statement}
                      lastError={runError}
                      focus={selectedObject}
                      seedPrompt={aiSeed}
                      onSeedConsumed={() => setAiSeed(undefined)}
                      onApply={(sql) => {
                        setStatement(sql);
                        setTab("query");
                      }}
                    />

                    {runError && !activePlan?.needsConfirmation && <FetchError message={runError} bare />}

                    {running && !lastResult && <SkeletonRows count={6} height={28} />}

                    {lastResult && (
                      <>
                        <ResultGrid
                          result={lastResult}
                          engine={active.engine}
                          table={selectedObject}
                          sort={sort}
                          onSort={applySort}
                          onFilterBy={applyFilter}
                          onAskAi={(prompt) => setAiSeed(prompt)}
                          onCopy={(text, what) => void copy(text, what)}
                          canEdit={editable}
                          editDisabledReason={detail?.notEditableReason ?? rowEdits.blocked ?? undefined}
                          editing={editable ? rowEdits : undefined}
                        />
                        {rowEdits.dirty && selectedObject && active.accessMode === "write" && (
                          <EditBar
                            connectionId={active.id}
                            connectionLabel={active.label}
                            dangerous={active.dangerous}
                            namespace={selectedObject.namespace}
                            table={selectedObject.name}
                            payload={rowEdits.payload}
                            count={rowEdits.count}
                            onDiscard={rowEdits.reset}
                            onApplied={() => {
                              rowEdits.reset();
                              toast.success("Changes applied");
                              // Re-read so the grid shows what the database now
                              // holds rather than what we hoped it would.
                              void run(statement);
                            }}
                          />
                        )}
                        <footer className="db-result-footer">
                          <span>
                            {lastResult.rows.length} row{lastResult.rows.length === 1 ? "" : "s"}
                            {lastResult.truncated && " (truncated)"}
                          </span>
                          <span>{formatDuration(lastResult.durationMs)}</span>
                          {lastResult.rowsAffected !== undefined && (
                            <span>{lastResult.rowsAffected} affected</span>
                          )}
                          {detail?.identity && tab === "data" && (
                            <span className="db-result-identity">
                              {detail.identity.description}
                            </span>
                          )}
                        </footer>
                      </>
                    )}

                    {!running && !lastResult && !runError && tab === "data" && (
                      <EmptyState
                        title="No rows yet"
                        subtitle="Pick a table on the left, or write a query on the Query tab."
                        bare
                      />
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <ContextMenu
        open={treeMenu !== null}
        position={treeMenu}
        groups={treeMenu?.groups ?? []}
        onClose={() => setTreeMenu(null)}
        label="Table actions"
      />

      {addOpen && (
        <AddConnectionDialog
          onClose={() => setAddOpen(false)}
          initial={editingConnection}
          onSaved={() => {
            setAddOpen(false);
            setEditingConnection(undefined);
            void refreshConnections();
          }}
        />
      )}
    </div>
  );
}

/**
 * A failed connect, with the machine-level reason when we have one.
 *
 * The whole point: "connect ETIMEDOUT" is not actionable, and "Tailscale is not
 * running" is. The raw error stays visible underneath, because sometimes the
 * preflight passes and the database really is the problem.
 */
function ConnectionProblem({
  message,
  preflight,
  onRetry,
  onFix,
  fixingId,
}: {
  message: string;
  preflight: DbPreflightPayload | null;
  onRetry: () => void;
  onFix: (remedy: NonNullable<DbPreflightPayload["checks"][number]["remedy"]>) => void;
  fixingId: string | null;
}) {
  const dotTone = (status: string) =>
    status === "pass" ? "success" : status === "warn" ? "warning" : "danger";

  const fixable = preflight?.checks.filter((c) => c.status === "fail" && c.remedy) ?? [];

  return (
    <div className="tone-panel tone-panel--warning db-connect-problem">
      <div className="db-connect-heading">
        <AlertTriangle size={14} aria-hidden />
        <strong>Connection unavailable</strong>
      </div>
      {preflight && (
        <ul className="db-preflight">
          {preflight.checks.map((check) => (
            <li key={check.label}>
              <span
                className={`tone-dot tone-dot--sm tone-dot--inline tone-dot--${dotTone(check.status)}`}
                aria-hidden
              />
              <span className="db-preflight-copy">
                <strong>{check.label}</strong>
                {check.detail && <span>{check.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The point of the panel. Knowing the tailnet is down is a diagnosis;
          this is the fix, and it reconnects for you afterwards. */}
      {fixable.length > 0 && (
        <div className="db-connect-fixes">
          {fixable.map((check) => (
            <button
              key={check.label}
              type="button"
              className="btn btn-primary"
              onClick={() => onFix(check.remedy!)}
              disabled={fixingId !== null}
            >
              <Wrench size={13} aria-hidden />
              {fixingId === check.remedy!.id
                ? (check.remedy!.pendingLabel ?? "Working…")
                : check.remedy!.label}
            </button>
          ))}
        </div>
      )}
      {preflight ? (
        <details className="db-connect-detail">
          <summary>Technical details</summary>
          <p className="db-connect-message">{message}</p>
        </details>
      ) : (
        <p className="db-connect-message">{message}</p>
      )}
      <button type="button" className="btn btn-ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function HistoryList({
  entries,
  onPick,
}: {
  entries: DbHistoryRow[];
  onPick: (statement: string) => void;
}) {
  if (entries.length === 0) {
    return <EmptyState title="No history yet" subtitle="Queries you run appear here." bare />;
  }
  return (
    <ul className="db-history">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button type="button" className="db-history-row" onClick={() => onPick(entry.statement)}>
            <span className={kindBadgeClass(entry.kind)}>{entry.kind}</span>
            <code className="db-history-statement">{entry.statement}</code>
            <span className="db-history-meta">
              {entry.connectionLabel} · {formatDuration(entry.durationMs)}
              {entry.ok ? ` · ${entry.rowCount ?? 0} rows` : " · failed"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Qualified, quoted table reference for the preview query. */
function quoteFor(engine: string, namespace: string, name: string): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  // SQLite has a single namespace, so qualifying is noise.
  return engine === "sqlite" ? quote(name) : `${quote(namespace)}.${quote(name)}`;
}
