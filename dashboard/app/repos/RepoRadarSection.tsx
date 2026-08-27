"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GraduationCap, Radar, X } from "lucide-react";
import { LabButton, LabSlot, useLab, useLabRecords, type LabRecordSummary } from "@/components/capability/LabInline";
import { useLive } from "@/lib/hooks/use-fetch";
import { AREA_LABEL_SHORT } from "@/lib/capability/labels";
import type { CapabilitySnapshot, RepoScan, SignalArea } from "@/lib/capability/types";

interface RadarPayload {
  snapshot: CapabilitySnapshot | null;
  aiConfigured?: boolean;
}

/**
 * Repo-level slice of the Capability Radar, shown inside the learn views. Reads
 * the latest aggregate snapshot, filters to this repo's detected signals, and
 * lets the user spin up a hands-on lab grounded in *this* repo for any of them.
 *
 * One lab is open at a time and renders in its OWN card below the signal list
 * (rather than inline mid-list, which used to split the rows apart).
 */
export function RepoRadarSection({
  repoName,
  autoOpenSignal,
}: {
  repoName: string;
  /** Signal id (from ?lab=) whose lab should open and scroll into view on load. */
  autoOpenSignal?: string;
}) {
  const { data } = useLive<RadarPayload>("/api/capability/radar", {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const snapshot = data?.snapshot ?? null;
  const { bySignal } = useLabRecords(repoName);
  const repo: RepoScan | undefined = snapshot?.repos.find((r) => r.repoName === repoName);
  const signals = repo ? [...repo.signals].sort((a, b) => b.confidence - a.confidence) : [];

  const [activeSignal, setActiveSignal] = useState<string | null>(autoOpenSignal ?? null);
  const active = activeSignal ? signals.find((s) => s.id === activeSignal) : undefined;

  function toggleSignal(id: string) {
    setActiveSignal((current) => (current === id ? null : id));
  }

  return (
    <>
      <div className="card card-body">
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
          <Radar size={14} aria-hidden /> Capability radar
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
          Technologies, patterns and concepts detected in this repo. Build a hands-on lab grounded in this codebase
          for any of them.
        </p>
        {!snapshot ? (
          <p className="mt-2 text-xs" style={{ color: "var(--text-subtle)" }}>
            No scan yet — run one from{" "}
            <a href="/radar" style={{ color: "var(--accent)" }}>
              Capability Radar
            </a>
            .
          </p>
        ) : signals.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--text-subtle)" }}>
            No signals detected here in the last scan.
          </p>
        ) : (
          <>
          {repo?.ownership && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Ownership familiarity">
              {repo.ownership.gaps.slice(0, 4).map((gap) => (
                <span key={gap.domainId} className="badge badge-muted">
                  {gap.label} · {Math.round(gap.familiarity * 100)}%
                </span>
              ))}
            </div>
          )}
          <ul className="mt-2 flex flex-col gap-1">
            {signals.map((s, i) => (
              <RepoSignalRow
                key={s.id}
                label={s.label}
                area={s.area}
                index={i}
                record={bySignal.get(s.id)}
                active={s.id === activeSignal}
                onToggle={() => toggleSignal(s.id)}
              />
            ))}
          </ul>
          </>
        )}
      </div>

      {active && (
        <RepoLabCard
          key={active.id}
          signalId={active.id}
          label={active.label}
          repoName={repoName}
          aiConfigured={data?.aiConfigured ?? false}
          record={bySignal.get(active.id)}
          onClose={() => setActiveSignal(null)}
        />
      )}
    </>
  );
}

function RepoSignalRow({
  label,
  area,
  index = 0,
  record,
  active,
  onToggle,
}: {
  label: string;
  area: SignalArea;
  index?: number;
  /** Already-generated lab for this signal in this repo, when one exists. */
  record?: LabRecordSummary;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2" style={{ "--i": index } as CSSProperties}>
      <span className="text-xs flex-1 min-w-0 truncate" style={{ color: active ? "var(--accent)" : "var(--text)" }}>
        {label}
      </span>
      <span className="text-[10px] uppercase tracking-wide shrink-0" style={{ color: "var(--text-subtle)" }}>
        {AREA_LABEL_SHORT[area]}
      </span>
      <LabButton
        onClick={onToggle}
        label={active ? "Hide" : record ? "Show lab" : "Lab"}
        done={record?.done}
        compact
      />
    </li>
  );
}

/**
 * The open lab, in its own card below the signal list. Keyed by signal id so
 * switching signals remounts with fresh state; loads (or builds) on mount.
 */
function RepoLabCard({
  signalId,
  label,
  repoName,
  aiConfigured,
  record,
  onClose,
}: {
  signalId: string;
  label: string;
  repoName: string;
  aiConfigured: boolean;
  record?: LabRecordSummary;
  onClose: () => void;
}) {
  const labState = useLab(signalId, repoName, !!record);
  const cardRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    void labState.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  return (
    <div ref={cardRef} className="card card-body lab-panel-enter flex flex-col max-h-[min(80vh,40rem)]">
      <div className="flex items-center gap-2 shrink-0">
        <GraduationCap size={14} style={{ color: "var(--accent)" }} aria-hidden />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--text)" }}>
          {label} — hands-on lab
        </span>
        <button
          type="button"
          className="btn btn-ghost shrink-0"
          style={{ fontSize: 12, padding: "3px 8px" }}
          onClick={onClose}
          aria-label="Close lab"
        >
          <X size={12} /> Close
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto mt-3">
        {labState.loading && !labState.lab && (
          <div>
            <p className="text-xs mb-2" style={{ color: "var(--text-subtle)" }}>
              OpenCode is building this lab in the terminal — watch it there; it appears here once registered.
            </p>
            <div className="space-y-1.5">
              <div className="skeleton" style={{ height: 10, width: "88%" }} />
              <div className="skeleton" style={{ height: 10, width: "70%" }} />
              <div className="skeleton" style={{ height: 10, width: "79%" }} />
            </div>
          </div>
        )}

        {!labState.loading && !labState.lab && (
          <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
            Couldn&apos;t load this lab.{" "}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "1px 6px", fontSize: 11 }}
              onClick={() => void labState.toggle()}
            >
              Retry
            </button>
          </p>
        )}

        <LabSlot state={labState} aiConfigured={aiConfigured} />
      </div>
    </div>
  );
}
