"use client";

import Link from "next/link";
import { AlertTriangle, Check, Circle } from "lucide-react";
import type { ImplementReadyItem, ImplementReadyResult } from "@/lib/tasks/implement-ready";

const HARD_BLOCK_KEY = "devhub:implement-ready-hard-block";

export function readLocalImplementHardBlock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HARD_BLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLocalImplementHardBlock(value: boolean): void {
  try {
    window.localStorage.setItem(HARD_BLOCK_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

export type ImplementReadyApiResponse = ImplementReadyResult & {
  taskId: string;
  date: string;
  notePath: string;
  repoIds: string[];
  prefsHardBlock: boolean;
};

function ItemRow({ item }: { item: ImplementReadyItem }) {
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
        {!item.ok && item.fixHref ? (
          <Link
            href={item.fixHref}
            className="mt-0.5 inline-block text-accent underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {item.fixLabel ?? "Fix"}
          </Link>
        ) : null}
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
  hardBlockLocal,
  onHardBlockLocal,
}: {
  loading: boolean;
  ready: ImplementReadyApiResponse | null;
  repoIds: string[];
  selectedRepoId: string | null;
  onSelectRepo: (id: string) => void;
  hardBlockLocal: boolean;
  onHardBlockLocal: (value: boolean) => void;
}) {
  const effectiveHardBlock = Boolean(ready?.hardBlock || hardBlockLocal);
  const showWarn = ready && !ready.ok;

  return (
    <section
      className="mb-4 rounded-lg px-3 py-2"
      style={{ border: "1px solid var(--border-muted)", background: "var(--bg-elevated)" }}
      aria-label="Implement ready checklist"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text">
          {showWarn ? <AlertTriangle size={12} className="text-amber-500" aria-hidden /> : null}
          Ready to implement
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={effectiveHardBlock}
            onChange={(e) => onHardBlockLocal(e.target.checked)}
          />
          Hard-block Launch
        </label>
      </div>

      {loading && !ready ? (
        <p className="text-xs text-text-muted">Checking checklist…</p>
      ) : ready ? (
        <ul className="grid gap-2">
          {ready.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">Couldn&apos;t load readiness checklist.</p>
      )}

      {repoIds.length > 1 ? (
        <fieldset className="mt-3 grid gap-1.5">
          <legend className="text-[11px] font-medium text-text-muted">Pick repo</legend>
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

      {showWarn && !effectiveHardBlock ? (
        <p className="mt-2 text-[11px] text-text-muted">Warnings only — Launch stays available.</p>
      ) : null}
      {showWarn && effectiveHardBlock ? (
        <p className="mt-2 text-[11px] text-amber-600">Hard-block on — fix the items above to Launch.</p>
      ) : null}
    </section>
  );
}
