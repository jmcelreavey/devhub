"use client";

import { useState } from "react";
import {
  Activity,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Globe,
  GraduationCap,
  RefreshCw,
  CircleHelp,
  SquareArrowOutUpRight,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { FetchError, PageHeader } from "@/components";
import {
  LabButton,
  LabSlot,
  useLab,
  useLabRecords,
  type LabRecordSummary,
} from "@/components/LabInline";
import { openLabWorkspaceInCursor } from "@/lib/open-in-cursor-client";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";
import { formatShortDate } from "@/lib/format-date";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { AREA_LABEL, AREA_ORDER } from "@/lib/capability/labels";
import type {
  CapabilityDiff,
  CapabilitySnapshot,
  DiffEntry,
  DriftEntry,
} from "@/lib/capability/types";

interface RadarPayload {
  snapshot: CapabilitySnapshot | null;
  diff: CapabilityDiff | null;
  snapshots: { id: string; createdAt: string; repoCount: number }[];
  aiConfigured: boolean;
}

function timeAgo(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "";
  return formatShortDate(d);
}

interface PersonalRadarPayload {
  path: string;
  exists: boolean;
  items: { ring: "adopt" | "trial" | "assess" | "hold"; text: string }[];
  markdown: string;
}

const RING_ORDER = ["adopt", "trial", "assess", "hold"] as const;
const RING_LABEL: Record<(typeof RING_ORDER)[number], string> = {
  adopt: "Adopt",
  trial: "Trial",
  assess: "Assess",
  hold: "Hold",
};

function PersonalRadarPanel() {
  const { data } = useLive<PersonalRadarPayload>("/api/radar/personal", { refreshInterval: 0 });
  if (!data?.exists) {
    return (
      <div className="card card-body mb-4 mt-3 text-xs text-text-subtle">
        <p>
          No personal radar yet. Create{" "}
          <Link href="/notes/radar/personal-radar" className="text-accent underline-offset-2 hover:underline">
            notes/radar/personal-radar
          </Link>{" "}
          with <code>## Adopt</code>, <code>## Trial</code>, <code>## Assess</code>, and{" "}
          <code>## Hold</code> sections (bullet lists under each).
        </p>
        <p className="mt-1.5 text-text-muted">
          Capability drift nudges on Today also deep-link here once this file exists.
        </p>
      </div>
    );
  }
  return (
    <section className="card mb-4 mt-3" aria-label="Personal tech radar">
      <div className="card-header flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">
          Personal radar
        </span>
        <span className="text-[11px] font-mono text-text-muted">
          notes/{data.path}
        </span>
      </div>
      <div className="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RING_ORDER.map((ring) => {
          const items = data.items.filter((i) => i.ring === ring);
          return (
            <div key={ring}>
              <div className="mb-1 text-[11px] font-semibold tracking-tight text-text-muted">
                {RING_LABEL[ring]}
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-text-subtle">
                  —
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-text-subtle">
                  {items.map((i) => (
                    <li key={i.text}>• {i.text}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Blip positions (percent of scope size) — spread across the rings. */
const SCOPE_BLIPS: [number, number][] = [
  [62, 28],
  [34, 56],
  [72, 64],
  [28, 34],
  [54, 74],
  [44, 20],
];

/**
 * The feature's signature mark: a pure-CSS radar scope with a rotating sweep
 * and pulsing blips (one per detected "thing", capped at the ring layout).
 */
function RadarScope({ size, blips = 4 }: { size: number; blips?: number }) {
  return (
    <div className="radar-scope" style={{ width: size, height: size }} aria-hidden>
      <div className="radar-scope-sweep" />
      {SCOPE_BLIPS.slice(0, Math.max(0, Math.min(blips, SCOPE_BLIPS.length))).map(([x, y], i) => (
        <span key={i} className="radar-scope-blip" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  );
}

export default function RadarClient() {
  const { data, isLoading, error, mutate } = useLive<RadarPayload>("/api/capability/radar", {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();

  const [scanning, setScanning] = useState(false);
  const [includeGithub, setIncludeGithub] = useState(false);
  const [githubFilter, setGithubFilter] = useState("");

  async function runScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/capability/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeGithub, githubFilter: githubFilter.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail || body.error || `Scan failed (${res.status})`);
      }
      const result = (await res.json()) as {
        warnings?: string[];
        snapshot: CapabilitySnapshot;
        diff?: CapabilityDiff;
      };
      for (const w of result.warnings ?? []) toast.info(w);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const snapshot = data?.snapshot ?? null;
  const diff = data?.diff ?? null;

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <PageHeader
        title="Capability Radar"
        subtitle={
          snapshot ? (
            <>
              Last scan {timeAgo(snapshot.createdAt)} · {snapshot.repoCount} repos ({snapshot.source.local} local
              {snapshot.source.github ? `, ${snapshot.source.github} remote` : ""})
            </>
          ) : (
            <>How your engineering environment is evolving - scan repos, see what&apos;s new, learn why.</>
          )
        }
        badge={
          snapshot ? (
            <span className="flex items-center gap-2">
              <RadarScope size={22} blips={Math.min(Object.keys(snapshot.signals).length, 6)} />
              <span className="badge badge-muted">{Object.keys(snapshot.signals).length} signals</span>
            </span>
          ) : undefined
        }
        actions={
          <button type="button" className="btn btn-primary text-xs" onClick={() => void runScan()} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : snapshot ? "Rescan" : "Run scan"}
          </button>
        }
      />

      <PersonalRadarPanel />

      <ScanControls
        includeGithub={includeGithub}
        setIncludeGithub={setIncludeGithub}
        githubFilter={githubFilter}
        setGithubFilter={setGithubFilter}
      />

      {scanning && <div className="radar-scanline mt-3" role="progressbar" aria-label="Scan in progress" />}

      {error ? (
        <FetchError message={error.message} onRetry={() => void mutate()} />
      ) : !isLoading && !snapshot ? (
        <div className="card flex flex-col items-center gap-4 mt-4 px-6 py-10 text-center">
          <RadarScope size={96} blips={4} />
          <div>
            <div className="text-sm font-semibold text-text">
              Nothing on the radar yet
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--text-subtle)", maxWidth: 420 }}>
              Run your first scan to map the technologies, patterns and concepts across your repos - then watch how
              they evolve week to week.
            </p>
          </div>
          <button type="button" className="btn btn-primary text-xs" onClick={() => void runScan()} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : "Run first scan"}
          </button>
        </div>
      ) : snapshot ? (
        <div className="flex flex-col gap-6 mt-2">
          <DigestSection includeGithub={includeGithub} githubFilter={githubFilter} />
          {diff && <EvolutionFeed diff={diff} aiConfigured={data?.aiConfigured ?? false} />}
          <Coverage snapshot={snapshot} />
          {diff && diff.drift.length > 0 && (
            <DriftPanel drift={diff.drift} aiConfigured={data?.aiConfigured ?? false} />
          )}
          <LabsSection />
        </div>
      ) : null}
    </div>
  );
}

function ScanControls({
  includeGithub,
  setIncludeGithub,
  githubFilter,
  setGithubFilter,
}: {
  includeGithub: boolean;
  setIncludeGithub: (v: boolean) => void;
  githubFilter: string;
  setGithubFilter: (v: string) => void;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-4 mt-3" style={{ padding: "10px 14px" }}>
      <label className="flex items-center gap-2 text-xs cursor-pointer text-text-muted">
        <input type="checkbox" checked={includeGithub} onChange={(e) => setIncludeGithub(e.target.checked)} />
        <Globe size={13} /> Also scan un-cloned GitHub repos
      </label>
      {includeGithub && (
        <input
          value={githubFilter}
          onChange={(e) => setGithubFilter(e.target.value)}
          placeholder="Filter by owner/org (optional)"
          className="input text-xs"
          style={{ maxWidth: 240 }}
        />
      )}
    </div>
  );
}

interface DigestPayload {
  latest: {
    id: string;
    headline: string;
    markdown: string;
    createdAt: string;
    source: string;
  } | null;
}

/**
 * "This week" evolution digest — the human-readable weekly summary produced by
 * the scheduled `capability_digest` job (or on demand here). Collapsed to the
 * headline; expands to the full markdown.
 */
function DigestSection({ includeGithub, githubFilter }: { includeGithub: boolean; githubFilter: string }) {
  const { data, mutate } = useLive<DigestPayload>("/api/capability/digest", {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const toast = useToast();
  const latest = data?.latest ?? null;

  async function refresh() {
    setRunning(true);
    try {
      const res = await fetch("/api/capability/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeGithub, githubFilter: githubFilter.trim() || undefined }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Digest failed");
      setOpen(true);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Digest failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <SectionTitle icon={<CalendarDays size={15} />} title="This week">
          Your engineering environment, summarised - runs weekly, or on demand
        </SectionTitle>
        <button
          type="button"
          className="btn btn-ghost text-xs ml-auto shrink-0"
          style={{ padding: "4px 8px" }}
          onClick={() => void refresh()}
          disabled={running}
        >
          <RefreshCw size={12} className={running ? "animate-spin" : ""} />
          {running ? "Running…" : "Generate"}
        </button>
      </div>
      <div className="card mt-2" style={{ padding: "12px 14px" }}>
        {latest ? (
          <>
            <button
              type="button"
              className="flex items-center gap-2 w-full text-left"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              <ChevronRight
                size={13}
                className="radar-chevron shrink-0 text-text-subtle"
                data-open={open}
                aria-hidden
              />
              <span className="text-sm font-medium flex-1 min-w-0 text-text">
                {latest.headline}
              </span>
              <span className="text-[11px] shrink-0 text-text-subtle">
                {latest.id} · {open ? "hide" : "view"}
              </span>
            </button>
            {open && (
              <div
                className="lab-panel-enter border-t mt-3 pt-3 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                <SimpleMarkdown text={latest.markdown} compact />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-text-subtle">
            No digest yet. Click <strong>Generate</strong> - or schedule the <code>capability_digest</code> job to run
            weekly.
          </p>
        )}
      </div>
    </section>
  );
}

function EvolutionFeed({ diff, aiConfigured }: { diff: CapabilityDiff; aiConfigured: boolean }) {
  const { bySignal } = useLabRecords();
  const nothing = diff.added.length === 0 && diff.spread.length === 0 && diff.removed.length === 0;
  return (
    <section>
      <SectionTitle icon={<TrendingUp size={15} />} title="Engineering evolution">
        {diff.fromId ? "Since your previous scan" : "First scan - baseline established"}
      </SectionTitle>
      {nothing ? (
        <p className="text-xs mt-2 text-text-subtle">
          {diff.fromId ? "No changes since the last scan." : "Everything here is new - this is your baseline. The next scan will show what changed."}
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {[
            ...diff.added.map((e) => ({ entry: e, tone: "new" as const })),
            ...diff.spread.map((e) => ({ entry: e, tone: "spread" as const })),
            ...diff.removed.map((e) => ({ entry: e, tone: "removed" as const })),
          ].map(({ entry, tone }) => (
            <DeltaCard
              key={`${tone}-${entry.id}`}
              entry={entry}
              tone={tone}
              aiConfigured={aiConfigured}
              record={bySignal.get(entry.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const TONE_META = {
  new: { label: "NEW", badgeClass: "radar-badge radar-badge-new" },
  spread: { label: "SPREADING", badgeClass: "radar-badge radar-badge-spread" },
  removed: { label: "GONE", badgeClass: "radar-badge radar-badge-gone" },
} as const;

function DeltaCard({
  entry,
  tone,
  aiConfigured,
  record,
}: {
  entry: DiffEntry;
  tone: "new" | "spread" | "removed";
  aiConfigured: boolean;
  record?: LabRecordSummary;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const labState = useLab(entry.id, undefined, !!record);

  async function explain() {
    setOpen(true);
    if (explanation || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/capability/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaId: entry.id }),
      });
      const body = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) throw new Error(body.error || "Explain failed");
      setExplanation(body.markdown ?? "_No explanation available._");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Explain failed");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card radar-card" style={{ padding: "12px 14px" }}>
      <div className="flex items-center gap-3">
        <span className={TONE_META[tone].badgeClass}>{TONE_META[tone].label}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text">
            {entry.label}
          </div>
          <div className="text-xs mt-0.5 text-text-subtle">
            {AREA_LABEL[entry.area]} ·{" "}
            {tone === "spread"
              ? `${entry.fromRepoCount} → ${entry.toRepoCount} repos`
              : `${entry.repos.length} repo${entry.repos.length === 1 ? "" : "s"}`}
            {entry.repos.length > 0 && <> · {entry.repos.slice(0, 4).join(", ")}{entry.repos.length > 4 ? "…" : ""}</>}
          </div>
        </div>
        {tone !== "removed" && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="btn btn-ghost text-xs"
              style={{ padding: "4px 8px" }}
              onClick={() => (open ? setOpen(false) : void explain())}
            >
              <CircleHelp size={12} />
              {loading ? "Thinking…" : open ? "Hide" : "Why?"}
            </button>
            <LabButton
              onClick={() => void labState.toggle()}
              label={labState.label}
              done={labState.lab?.done ?? record?.done}
              loading={labState.loading}
            />
          </div>
        )}
      </div>
      {open && (
        <div className="lab-panel-enter border-t mt-3 pt-3 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          {loading ? (
            <span className="text-text-subtle">Gathering evidence…</span>
          ) : explanation ? (
            <>
              {!aiConfigured && (
                <p className="mb-2 text-[11px] text-text-subtle">
                  AI is off (set <code>AI_API_KEY</code>) - showing commit evidence only.
                </p>
              )}
              <SimpleMarkdown text={explanation} compact />
            </>
          ) : null}
        </div>
      )}
      <LabSlot state={labState} aiConfigured={aiConfigured} />
    </div>
  );
}

function Coverage({ snapshot }: { snapshot: CapabilitySnapshot }) {
  const rolls = Object.values(snapshot.signals);
  const maxRepos = Math.max(1, ...rolls.map((r) => r.repos.length));
  const byArea = AREA_ORDER.map((area) => ({
    area,
    items: rolls.filter((r) => r.area === area).sort((a, b) => b.repos.length - a.repos.length || b.count - a.count),
  })).filter((g) => g.items.length > 0);

  return (
    <section>
      <SectionTitle icon={<Boxes size={15} />} title="Stack coverage">
        What your repos depend on, by area
      </SectionTitle>
      <div className="flex flex-col gap-4 mt-2">
        {byArea.map((group) => (
          <div key={group.area}>
            <div className="text-[11px] font-medium tracking-tight mb-1.5 text-text-subtle">
              {AREA_LABEL[group.area]}
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2"
                  title={`${item.label} - ${item.repos.join(", ")}`}
                >
                  <div className="text-xs w-24 sm:w-40 shrink-0 truncate text-text">
                    {item.label}
                  </div>
                  <div className="flex-1 h-3 rounded overflow-hidden bg-bg-muted">
                    <div
                      className="radar-bar-fill"
                      style={{ width: `${(item.repos.length / maxRepos) * 100}%` }}
                    />
                  </div>
                  <div className="text-[11px] w-16 text-right shrink-0 text-text-subtle">
                    {item.repos.length} repo{item.repos.length === 1 ? "" : "s"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DriftPanel({ drift, aiConfigured }: { drift: DriftEntry[]; aiConfigured: boolean }) {
  const { bySignal } = useLabRecords();
  return (
    <section>
      <SectionTitle icon={<Activity size={15} />} title="Knowledge drift">
        Growing across repos while your hands-on exposure goes stale - close the gap with a lab
      </SectionTitle>
      <div className="flex flex-col gap-2 mt-2">
        {drift.map((d) => (
          <DriftRow key={d.id} d={d} aiConfigured={aiConfigured} record={bySignal.get(d.id)} />
        ))}
      </div>
    </section>
  );
}

function DriftRow({
  d,
  aiConfigured,
  record,
}: {
  d: DriftEntry;
  aiConfigured: boolean;
  record?: LabRecordSummary;
}) {
  const labState = useLab(d.id, undefined, !!record);
  return (
    <div className="card radar-card flex flex-col" style={{ padding: "10px 14px" }}>
      <div className="flex items-center gap-3">
        <Clock size={14} className="shrink-0 text-warning" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text">{d.label}</div>
          <div className="text-xs mt-0.5 text-text-subtle">
            {d.daysSinceMine === null
              ? "You haven't authored any of these files"
              : `${d.daysSinceMine} days since you touched it`}
            {d.repoDelta > 0 && <> · now in {d.repoDelta} more repo{d.repoDelta === 1 ? "" : "s"} ({d.repoCount} total)</>}
          </div>
        </div>
        <LabButton
          onClick={() => void labState.toggle()}
          label={labState.label}
          done={labState.lab?.done ?? record?.done}
          loading={labState.loading}
        />
      </div>
      <LabSlot state={labState} aiConfigured={aiConfigured} />
    </div>
  );
}

/**
 * Every lab you've generated, in one place: open the note, jump into the
 * workspace, see what's done. Answers "which labs do I already have?" without
 * hunting through signals.
 */
function LabsSection() {
  const { records } = useLabRecords();
  const toast = useToast();
  if (records.length === 0) return null;

  return (
    <section>
      <SectionTitle icon={<GraduationCap size={15} />} title="Your labs">
        Hands-on labs you&apos;ve generated - saved to Learnings, workspaces under kitchen-sink
      </SectionTitle>
      <div className="flex flex-col gap-1.5 mt-2">
        {records.map((r) => (
          <div key={r.category} className="card radar-card flex items-center gap-3" style={{ padding: "8px 14px" }}>
            {r.done ? (
              <CheckCircle2 size={14} className="shrink-0 text-success" aria-label="Done" />
            ) : (
              <Circle size={14} className="shrink-0 text-text-subtle" aria-label="In progress" />
            )}
            <div className="flex-1 min-w-0">
              {/* Title opens the live experience (lab + tutor + workspace);
                  the panel's own "Learnings" link covers the static note. */}
              <Link
                href={`/repos/learn/${encodeURIComponent(r.repoName)}?lab=${encodeURIComponent(r.signalId)}`}
                className="text-sm hover:underline text-text"
              >
                {r.label} <span className="text-text-subtle">in {r.repoName}</span>
              </Link>
              <div className="text-[11px] text-text-subtle">
                {formatShortDate(Date.parse(r.generatedAt))}
                {r.source !== "ai" && " · evidence-only"}
                {r.done && r.completedAt && ` · completed ${formatShortDate(Date.parse(r.completedAt))}`}
              </div>
            </div>
            {r.hasWorkspace && (
              <button
                type="button"
                className="btn btn-ghost text-xs shrink-0"
                style={{ padding: "4px 8px" }}
                onClick={() => void openLabWorkspaceInCursor(r.category, toast)}
                title="Open the lab workspace in Cursor"
              >
                <SquareArrowOutUpRight size={12} /> Workspace
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      {children && (
        <div className="text-xs mt-0.5 text-text-subtle">
          {children}
        </div>
      )}
    </div>
  );
}
