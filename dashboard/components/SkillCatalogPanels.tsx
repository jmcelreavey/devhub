"use client";

import type { CSSProperties } from "react";
import { useClientMounted } from "@/lib/use-client-mounted";
import {
  SKILL_SOURCE_FILTER_OPTIONS,
  type AiToolsMeta,
  type SkillListItem,
  type SkillSourceFilter,
} from "@/lib/skills-api-types";
import {
  localCatalogStatusLabel,
  type ManagedCatalogRow,
} from "@/lib/managed-catalog-rows";

export function SkillUpstreamBanner(props: {
  aiTools: AiToolsMeta | null;
  lastCommit: string | null;
  refreshing?: boolean;
}) {
  const { aiTools, lastCommit, refreshing } = props;
  if (!aiTools) return null;

  if (!aiTools.syncEnabled) {
    return (
      <p className="text-xs mb-2" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
        ai-tools upstream disabled (<code>AI_TOOLS_SYNC=0</code>). Only DevHub skills sync.
      </p>
    );
  }

  if (!aiTools.available) {
    return (
      <p className="text-xs mb-2" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
        ai-tools not found at <code>{aiTools.root}</code> - clone the repo or set{" "}
        <code>AI_TOOLS_ROOT</code>. Only DevHub skills will sync until then.
      </p>
    );
  }

  return (
    <p className="text-xs mb-2" style={{ color: "var(--text-subtle)", lineHeight: 1.5 }}>
      Upstream: <code>{aiTools.path ?? aiTools.root}</code>
      {refreshing ? (
        <> · fetching latest skills…</>
      ) : lastCommit ? (
        <>
          {" "}
          · <code>{lastCommit}</code>
        </>
      ) : null}
    </p>
  );
}

export function CatalogSourceFilterBar<T extends string>(props: {
  ariaLabel: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  counts: Record<T, number> & { all: number };
  filter: T;
  onFilterChange: (filter: T) => void;
  loading?: boolean;
}) {
  const mounted = useClientMounted();
  const countLabel = (id: T) => {
    if (!mounted) return "-";
    if (props.loading && props.counts.all === 0 && id !== ("all" as T)) return "…";
    return String(props.counts[id]);
  };

  return (
    <div className="flex gap-1 flex-wrap" role="group" aria-label={props.ariaLabel}>
      {props.options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`btn btn-ghost text-xs ${props.filter === id ? "active" : ""}`}
          aria-pressed={props.filter === id}
          disabled={props.loading && props.counts.all === 0}
          onClick={() => props.onFilterChange(id)}
        >
          {label} ({countLabel(id)})
        </button>
      ))}
    </div>
  );
}

export function SkillSourceFilterBar(props: {
  counts: Record<SkillSourceFilter, number>;
  filter: SkillSourceFilter;
  onFilterChange: (filter: SkillSourceFilter) => void;
  loading?: boolean;
}) {
  return (
    <CatalogSourceFilterBar
      ariaLabel="Filter skills by source"
      options={SKILL_SOURCE_FILTER_OPTIONS}
      counts={props.counts}
      filter={props.filter}
      onFilterChange={props.onFilterChange}
      loading={props.loading}
    />
  );
}

export function SkillRowBadges(props: {
  source?: SkillListItem["source"];
  overridesUpstream?: boolean;
}) {
  return (
    <>
      {props.source === "ai-tools" && (
        <span className="badge badge-muted" style={{ fontSize: "9px", padding: "1px 5px" }}>
          ai-tools
        </span>
      )}
      {props.source === "devhub" && (
        <span className="badge badge-muted" style={{ fontSize: "9px", padding: "1px 5px" }}>
          DevHub
        </span>
      )}
      {props.source?.startsWith("plugin:") && (
        <span
          className="badge badge-muted"
          style={{ fontSize: "9px", padding: "1px 5px" }}
          title={`Contributed by the ${props.source.slice("plugin:".length)} plugin (read-only)`}
        >
          {props.source.slice("plugin:".length)}
        </span>
      )}
      {props.overridesUpstream && (
        <span
          style={{
            fontSize: "9px",
            padding: "1px 5px",
            borderRadius: "3px",
            background: "var(--bg-elevated)",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
          title="DevHub copy replaces the same-named ai-tools skill on sync"
        >
          overrides ai-tools
        </span>
      )}
    </>
  );
}

const migrationBadgeStyle: CSSProperties = {
  fontSize: "9px",
  padding: "1px 5px",
  borderRadius: "3px",
  background: "var(--accent-dim)",
  color: "var(--accent)",
  fontWeight: 600,
};

export function ManagedRowBadges(props: { row: ManagedCatalogRow }) {
  const { row } = props;
  if (row.kind === "local-only") {
    return (
      <>
        <span className="badge badge-muted" style={{ fontSize: "9px", padding: "1px 5px" }}>
          local only
        </span>
        <span style={migrationBadgeStyle}>{localCatalogStatusLabel(row.candidate.status)}</span>
      </>
    );
  }
  const skillItem = "source" in row.item ? row.item : null;
  return (
    <>
      {skillItem ? (
        <SkillRowBadges source={skillItem.source} overridesUpstream={skillItem.overridesUpstream} />
      ) : (
        <span className="badge badge-muted" style={{ fontSize: "9px", padding: "1px 5px" }}>
          DevHub
        </span>
      )}
      {row.localCandidate ? (
        <span style={migrationBadgeStyle} title="Local copy differs from catalog">
          {localCatalogStatusLabel(row.localCandidate.status)}
        </span>
      ) : null}
    </>
  );
}

const AGENT_FILTER_OPTIONS = [
  { id: "all" as const, label: "All" },
  { id: "local" as const, label: "Local" },
];

export function AgentLocalFilterBar(props: {
  counts: { all: number; local: number };
  filter: "all" | "local";
  onFilterChange: (filter: "all" | "local") => void;
  loading?: boolean;
}) {
  return (
    <CatalogSourceFilterBar
      ariaLabel="Filter agents by source"
      options={AGENT_FILTER_OPTIONS}
      counts={props.counts}
      filter={props.filter}
      onFilterChange={props.onFilterChange}
      loading={props.loading}
    />
  );
}
