"use client";

import { useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { GithubPrRow } from "@/lib/github/prs";

const SETTINGS_KEY = "/api/github/prs/auto-review/settings";
const QUEUE_URL = "/api/github/prs/auto-review";

type PollerMode = "off" | "hours" | "always";

interface PollerSettings {
  enabled: boolean;
  always: boolean;
  intervalMs?: number;
}

interface AutoReviewResponse {
  error?: string;
  candidates?: { row: GithubPrRow }[];
  started?: { repo: string; number: number }[];
  errors?: { error: string }[];
}

const MODE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "hours", label: "Work hours" },
  { value: "always", label: "Always" },
] as const;

function modeOf(settings: PollerSettings | undefined): PollerMode {
  if (!settings?.enabled) return "off";
  return settings.always ? "always" : "hours";
}

function settingsFor(mode: PollerMode): PollerSettings {
  return mode === "off" ? { enabled: false, always: false } : { enabled: true, always: mode === "always" };
}

async function postQueue(body: Record<string, unknown>): Promise<AutoReviewResponse> {
  const res = await fetch(QUEUE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as AutoReviewResponse;
  if (!res.ok) throw new Error(json.error ?? json.errors?.[0]?.error ?? `Auto-review failed (HTTP ${res.status})`);
  return json;
}

/**
 * Review-requested toolbar: the background auto-review schedule, plus a manual
 * "review the next PR" that confirms the exact PR before starting it. Reviews
 * are written to notes — nothing is posted to GitHub.
 */
export function AutoReviewBar({ disabled }: { disabled: boolean }) {
  const toast = useToast();
  const settings = useLive<PollerSettings>(SETTINGS_KEY, { refreshInterval: 0 });
  const [saving, setSaving] = useState(false);
  const [finding, setFinding] = useState(false);
  const [candidate, setCandidate] = useState<GithubPrRow | null>(null);
  const [starting, setStarting] = useState(false);

  const changeMode = async (mode: PollerMode) => {
    const next = settingsFor(mode);
    setSaving(true);
    try {
      await settings.mutate(
        async () => {
          const res = await fetch(SETTINGS_KEY, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(next),
          });
          const json = (await res.json().catch(() => ({}))) as PollerSettings & { error?: string };
          if (!res.ok) throw new Error(json.error ?? "Couldn't save the auto-review schedule");
          return json;
        },
        { optimisticData: { ...settings.data, ...next }, rollbackOnError: true, revalidate: false },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the auto-review schedule");
    } finally {
      setSaving(false);
    }
  };

  const findNext = async () => {
    setFinding(true);
    try {
      const { candidates = [] } = await postQueue({ dryRun: true, limit: 1 });
      const next = candidates[0]?.row;
      if (next) setCandidate(next);
      else toast.info("Nothing to review — every request is a draft, skipped, or already reviewed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't check the review queue");
    } finally {
      setFinding(false);
    }
  };

  const start = async () => {
    if (!candidate) return;
    setStarting(true);
    try {
      const result = await postQueue({ dryRun: false, limit: 1, url: candidate.url });
      const failure = result.errors?.[0]?.error;
      if (failure) toast.error(failure);
      else if (result.started?.length) toast.success(`Agent is reviewing ${candidate.repo}#${candidate.number}`);
      else toast.info(`${candidate.repo}#${candidate.number} no longer needs a review`);
      setCandidate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the review");
    } finally {
      setStarting(false);
    }
  };

  const mode = modeOf(settings.data);
  const every = `every ${Math.round((settings.data?.intervalMs ?? 900_000) / 60_000)} min`;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-muted px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span>Auto-review</span>
        <ToggleGroup
          aria-label="Auto-review schedule"
          options={MODE_OPTIONS.map((o) => ({ ...o, disabled: saving || !settings.data }))}
          value={mode}
          onChange={(value) => void changeMode(value)}
        />
        <span className="text-text-subtle">
          {mode === "off"
            ? "Agent reviews run only when you ask."
            : mode === "hours"
              ? `Checks ${every} during weekday work hours.`
              : `Checks ${every} while DevHub is open.`}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-secondary text-xs"
        disabled={disabled || finding}
        onClick={() => void findNext()}
      >
        {finding ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ScanSearch size={12} aria-hidden />}
        Review next PR
      </button>

      <ModalShell
        open={candidate !== null}
        onClose={() => setCandidate(null)}
        title="Start an agent review?"
        description="The review is saved to your notes. Nothing is posted to GitHub."
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setCandidate(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void start()}>
              {starting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <ScanSearch size={13} aria-hidden />}
              Start review
            </button>
          </div>
        }
      >
        {candidate ? (
          <div className="text-sm">
            <p className="font-medium text-text">{candidate.title}</p>
            <p className="mt-1 text-xs text-text-muted">
              {candidate.repo}#{candidate.number}
              {candidate.author?.login ? ` · ${candidate.author.login}` : ""}
            </p>
          </div>
        ) : null}
      </ModalShell>
    </div>
  );
}
