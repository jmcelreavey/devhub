"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, Circle } from "lucide-react";
import type { ImplementReadyItem, ImplementReadyResult } from "@/lib/tasks/implement-ready";

export type ImplementReadyApiResponse = ImplementReadyResult & {
  taskId: string;
  date: string;
  notePath: string;
  noteExists: boolean;
  repoIds: string[];
  prefsHardBlock: boolean;
};

export interface ImplementReadyActions {
  /** Leave the dialog for an in-app page (note, prerequisite task). */
  onNavigate: (href: string) => void;
  onOpenNote: () => void;
  onGeneratePlan: () => void;
  onCreateNote: () => void;
  /** Open the link picker. Always additive — picking a repo never drops the others. */
  onLinkRepo: () => void;
  creatingNote: boolean;
  planRunning: boolean;
}

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="text-accent underline-offset-2 hover:underline disabled:opacity-50 disabled:no-underline"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function itemActions(
  item: ImplementReadyItem,
  ready: ImplementReadyApiResponse,
  repoIds: string[],
  actions: ImplementReadyActions,
): ReactNode {
  if (item.id === "acceptance") {
    if (ready.noteExists) return <ActionButton onClick={actions.onOpenNote}>Open task note</ActionButton>;
    if (item.ok) return null;
    return (
      <>
        <ActionButton onClick={actions.onGeneratePlan} disabled={actions.planRunning}>
          {actions.planRunning ? "Plan agent running…" : "Generate plan"}
        </ActionButton>
        <ActionButton onClick={actions.onCreateNote} disabled={actions.creatingNote}>
          {actions.creatingNote ? "Creating…" : "Create blank note"}
        </ActionButton>
        <ActionButton onClick={actions.onOpenNote}>Open task note</ActionButton>
      </>
    );
  }
  if (item.id === "repo") {
    return <ActionButton onClick={actions.onLinkRepo}>{repoIds.length > 0 ? "Add repo" : "Link repo"}</ActionButton>;
  }
  if (!item.ok && item.fixHref) {
    const href = item.fixHref;
    return <ActionButton onClick={() => actions.onNavigate(href)}>{item.fixLabel ?? "Fix"}</ActionButton>;
  }
  return null;
}

function ItemRow({ item, children }: { item: ImplementReadyItem; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {item.ok ? (
        <Check size={12} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <Circle size={12} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
      )}
      <span className="min-w-0">
        <span className="font-medium text-text">{item.label}</span>
        {item.detail ? <span className="block text-text-muted">{item.detail}</span> : null}
        {children ? <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">{children}</span> : null}
      </span>
    </li>
  );
}

export function ImplementReadyPanel({
  loading,
  ready,
  repoIds,
  selectedRepoId,
  onSelectRepo,
  actions,
}: {
  loading: boolean;
  ready: ImplementReadyApiResponse | null;
  repoIds: string[];
  selectedRepoId: string | null;
  onSelectRepo: (id: string) => void;
  actions: ImplementReadyActions;
}) {
  const showWarn = ready && !ready.ok;

  return (
    <section
      className="mb-4 rounded-lg px-3 py-2"
      style={{ border: "1px solid var(--border-muted)", background: "var(--bg-elevated)" }}
      aria-label="Implement ready checklist"
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text">
        {showWarn ? <AlertTriangle size={12} className="text-amber-500" aria-hidden /> : null}
        Ready to implement
      </div>

      {loading && !ready ? (
        <p className="text-xs text-text-muted">Checking checklist…</p>
      ) : ready ? (
        <ul className="grid gap-2">
          {ready.items.map((item) => (
            <ItemRow key={item.id} item={item}>
              {itemActions(item, ready, repoIds, actions)}
            </ItemRow>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">Couldn&apos;t load readiness checklist.</p>
      )}

      {repoIds.length > 1 ? (
        <fieldset className="mt-3 grid gap-1.5">
          <legend className="text-[11px] font-medium text-text-muted">Start in (other linked repos stay on the task)</legend>
          {repoIds.map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 text-xs text-text">
              <input
                type="radio"
                name="implement-ready-repo"
                value={id}
                checked={selectedRepoId?.toLowerCase() === id.toLowerCase()}
                onChange={() => onSelectRepo(id)}
              />
              <span className="truncate">{id}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {showWarn ? <p className="mt-2 text-[11px] text-text-muted">Warnings only — Launch stays available.</p> : null}
    </section>
  );
}
