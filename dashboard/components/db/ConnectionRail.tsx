"use client";

import { useCallback, useMemo, useState } from "react";
import { Database, Leaf, Plus, RefreshCw, Server } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { SearchInput } from "@/components/ui/SearchInput";
import { HoverTip } from "@/components/ui/HoverTip";
import { ContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { DbConnectionRow } from "./shared";
import { credentialWarning, toneVar } from "./shared";
import { useMinuteTick } from "@/lib/minute-tick";
import { connectionMenuGroups, type ConnectionMenuActions } from "./menus";

const ENGINE_ICON = {
  postgres: Server,
  mongodb: Leaf,
  sqlite: Database,
} as const;

interface ConnectionRailProps {
  connections: DbConnectionRow[];
  errors: { providerId: string; message: string }[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onAdd: () => void;
  refreshing: boolean;
  menuActions: Omit<ConnectionMenuActions, "onOpen" | "onRefresh">;
  /** Applying a provider remedy (e.g. an AWS profile switch). */
  remedyPendingId: string | null;
}

/**
 * The list of everything you could connect to, grouped by provider.
 *
 * The environment stripe down the left of each row is the one piece of colour
 * that earns its place: knowing you are looking at prd before you type is worth
 * more than any label, and the row you are about to click is exactly where your
 * eye already is.
 *
 * Rows you cannot currently use still list, dimmed, with the reason and — when
 * the provider offers one — a button that fixes it. Hiding them would mean the
 * rail silently omitted databases you have standing permission for, just
 * because of which profile you happen to be holding.
 */
export function ConnectionRail({
  connections,
  errors,
  loading,
  error,
  activeId,
  onSelect,
  onRefresh,
  onAdd,
  refreshing,
  menuActions,
  remedyPendingId,
}: ConnectionRailProps) {
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; groups: ContextMenuGroup[] } | null>(
    null,
  );
  // Re-render once a minute so an expiry countdown actually counts down.
  const now = useMinuteTick();

  const openMenu = useCallback(
    (event: React.MouseEvent, connection: DbConnectionRow) => {
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        groups: connectionMenuGroups(connection, { ...menuActions, onOpen: onSelect, onRefresh }),
      });
    },
    [menuActions, onSelect, onRefresh],
  );

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? connections.filter(
          (c) =>
            c.label.toLowerCase().includes(needle) ||
            c.id.toLowerCase().includes(needle) ||
            (c.group ?? "").toLowerCase().includes(needle),
        )
      : connections;

    const byGroup = new Map<string, DbConnectionRow[]>();
    for (const connection of matching) {
      const key = connection.group ?? "Other";
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(connection);
      else byGroup.set(key, [connection]);
    }
    return [...byGroup.entries()];
  }, [connections, filter]);

  return (
    <aside className="db-rail">
      <div className="db-rail-head">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter connections"
          wrapperClassName="db-rail-search"
        />
        <div className="db-rail-actions">
          <HoverTip label="Add a connection">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onAdd}
              aria-label="Add a connection"
            >
              <Plus size={14} />
            </button>
          </HoverTip>
          <HoverTip label="Re-derive from your current access">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh connections"
            >
              {/* Spin only for the action the user just triggered. */}
              <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
            </button>
          </HoverTip>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="tone-panel tone-panel--warning db-rail-errors">
          {errors.map((e) => (
            <p key={e.providerId}>
              <strong>{e.providerId}</strong> could not list connections: {e.message}
            </p>
          ))}
        </div>
      )}

      <div className="db-rail-list">
        {loading && <SkeletonRows count={6} height={34} variant="list" />}
        {!loading && error && <FetchError message={error} onRetry={onRefresh} bare />}
        {!loading && !error && connections.length === 0 && (
          <EmptyState
            title="No connections yet"
            subtitle="Add a SQLite file or a database server to get started. BI connections appear once an AWS profile is active."
            bare
          />
        )}
        {!loading && !error && connections.length > 0 && groups.length === 0 && (
          <EmptyState title="No matches" subtitle={`Nothing matches “${filter}”.`} bare />
        )}

        {groups.map(([group, rows]) => (
          <section key={group} className="db-rail-group">
            <h3 className="db-rail-group-label">{group}</h3>
            {rows.map((connection) => {
              const Icon = ENGINE_ICON[connection.engine];
              const unavailable = Boolean(connection.unavailable);
              const isActive = connection.id === activeId;
              const pending = remedyPendingId === connection.id;
              const expiry = credentialWarning(connection.credentialsExpireAt, now);

              return (
                <div key={connection.id} className="db-rail-item">
                  <button
                    type="button"
                    className={`db-rail-row${isActive ? " is-active" : ""}${
                      unavailable ? " is-unavailable" : ""
                    }`}
                    onClick={() => onSelect(connection.id)}
                    onContextMenu={(e) => openMenu(e, connection)}
                    // Not `disabled`: an unavailable connection is still worth
                    // opening, because that is where the preflight explains why.
                    title={connection.unavailable}
                    style={{ "--db-row-tone": toneVar(connection.tone) } as React.CSSProperties}
                  >
                    <span className="db-rail-stripe" aria-hidden />
                    <Icon size={14} strokeWidth={1.7} className="db-rail-icon" />
                    <span className="db-rail-label">{connection.label}</span>
                    <span className="db-rail-meta">
                      {/* Only inside the last fifteen minutes — an always-on
                          countdown stops being information. The full sentence
                          lives in the tooltip so the badge stays short. */}
                      {expiry && (
                        <span
                          className={`badge badge-${expiry.tone === "danger" ? "danger" : "warning"}`}
                          title={
                            connection.credentialsExpireAt
                              ? `AWS credentials for this environment ${
                                  expiry.text === "Expired" ? "expired at" : "expire at"
                                } ${new Date(connection.credentialsExpireAt).toLocaleTimeString()}`
                              : undefined
                          }
                        >
                          {expiry.text}
                        </span>
                      )}
                      {connection.open && (
                        <span
                          className="tone-dot tone-dot--sm tone-dot--inline tone-dot--success"
                          aria-label="Connected"
                        />
                      )}
                      {connection.accessMode === "write" && (
                        <span
                          className={
                            connection.dangerous ? "badge badge-danger" : "badge badge-warning"
                          }
                        >
                          {connection.dangerous ? "prd write" : "write"}
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Shown only for the row you are looking at, so a rail of
                      thirty connections is not a wall of buttons. */}
                  {connection.remedy && isActive && (
                    <button
                      type="button"
                      className="btn btn-ghost db-rail-remedy"
                      onClick={() => menuActions.onRemedy?.(connection)}
                      disabled={pending}
                    >
                      <RefreshCw size={12} className={pending ? "animate-spin" : undefined} />
                      {pending
                        ? (connection.remedy.pendingLabel ?? "Working…")
                        : connection.remedy.label}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <ContextMenu
        open={menu !== null}
        position={menu}
        groups={menu?.groups ?? []}
        onClose={() => setMenu(null)}
        label="Connection actions"
      />
    </aside>
  );
}
