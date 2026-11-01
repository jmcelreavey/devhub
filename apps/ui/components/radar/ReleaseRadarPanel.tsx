"use client";

/**
 * Where the estate disagrees with itself about a dependency's major version.
 *
 * A second panel on /radar rather than its own route: it answers the same shape
 * of question as capability drift — "what changed across my repos, and what
 * should I do about it" — and a separate page would split attention and
 * duplicate the scan controls for no gain.
 */
import { useState } from "react";
import { Boxes, ChevronRight } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { AcknowledgeButton } from "./AcknowledgeButton";

interface LineUsage {
  line: string;
  repos: string[];
}

interface Advisory {
  id: string;
  name: string;
  latestLine: string;
  lines: LineUsage[];
  behindRepos: string[];
  spread: number;
  devOnly: boolean;
  repoCount: number;
}

interface ReleasePayload {
  advisories: Advisory[];
  acknowledged: Array<Advisory & { acknowledgedAt: string }>;
  acknowledgedCount: number;
  reposWithManifests: number;
  reposScanned: number;
  manifestsRead: number;
}

function AdvisoryRow({
  a,
  acknowledged = false,
  onChange,
}: {
  a: Advisory;
  acknowledged?: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="card radar-card flex flex-col"
      style={{ padding: "10px 14px", opacity: acknowledged ? 0.6 : undefined }}
    >
      <div className="flex items-center gap-3">
        <Boxes size={14} className="shrink-0 text-accent" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text flex items-center gap-2">
            <span className="font-mono">{a.name}</span>
            {a.devOnly && <span className="text-[10px] text-text-muted uppercase">dev</span>}
          </div>
          <div className="text-xs mt-0.5 text-text-subtle">
            {a.behindRepos.length} of {a.repoCount} repo{a.repoCount === 1 ? "" : "s"} behind{" "}
            <span className="font-mono">v{a.latestLine}</span> · {a.lines.length} versions in use
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs flex items-center gap-1 shrink-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronRight
            size={13}
            style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}
          />
          Repos
        </button>
        <AcknowledgeButton
          kind="release"
          id={a.id}
          watermark={a.behindRepos.length}
          acknowledged={acknowledged}
          onDone={onChange}
        />
      </div>

      {open && (
        <div className="mt-2 pl-6 flex flex-col gap-1">
          {a.lines.map((usage) => (
            <div key={usage.line} className="text-xs flex gap-2">
              {/* The newest line names the repo to copy the upgrade from — the
                  most useful thing on the row, so it is styled to stand out. */}
              <span
                className={`font-mono shrink-0 w-14 ${
                  usage.line === a.latestLine ? "text-success" : "text-text-muted"
                }`}
              >
                v{usage.line}
              </span>
              <span className="text-text-subtle">{usage.repos.join(", ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReleaseRadarPanel() {
  const { data, mutate } = useLive<ReleasePayload>("/api/radar/releases", {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  if (!data) return null;
  const { advisories, acknowledged } = data;
  if (advisories.length === 0 && acknowledged.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {advisories.length === 0 && acknowledged.length > 0 && (
        <div className="text-xs text-text-subtle px-1">Nothing new since you last looked.</div>
      )}

      {advisories.map((a) => (
        <AdvisoryRow key={a.id} a={a} onChange={() => void mutate()} />
      ))}

      {acknowledged.length > 0 && (
        <>
          <button
            type="button"
            className="btn-ghost text-xs self-start"
            onClick={() => setShowAcknowledged((v) => !v)}
          >
            {showAcknowledged ? "Hide" : "Show"} {acknowledged.length} already seen
          </button>
          {showAcknowledged &&
            acknowledged.map((a) => (
              <AdvisoryRow key={a.id} a={a} acknowledged onChange={() => void mutate()} />
            ))}
        </>
      )}
    </div>
  );
}
