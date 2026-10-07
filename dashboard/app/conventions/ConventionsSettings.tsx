"use client";

import { useState } from "react";
import { FetchError, SkeletonRows } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { AiProviderId } from "@/lib/ai/preference";
import type { ConventionsPrefs } from "@/lib/conventions/types";
import { postConventions, type SettingsPayload } from "./api";

const PR_LIMITS = [10, 20, 30, 40, 50];
const INTERVALS: { hours: number; label: string }[] = [
  { hours: 1, label: "hour" },
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "week" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text mb-1">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-text-muted mt-1">{hint}</span> : null}
    </label>
  );
}

export function ConventionsSettings({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, error, mutate } = useLive<SettingsPayload>("/api/conventions?settings=1", { refreshInterval: 0 });
  // Only the fields you've touched; everything else follows the saved prefs.
  const [edits, setEdits] = useState<Partial<ConventionsPrefs>>({});
  const [saving, setSaving] = useState(false);

  if (error && !data) return <FetchError message={error.message} onRetry={() => void mutate()} />;
  if (!data) return <SkeletonRows count={2} height={72} />;

  const draft: ConventionsPrefs = { ...data.prefs, ...edits };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.prefs);
  const patch = (change: Partial<ConventionsPrefs>): void => setEdits((prev) => ({ ...prev, ...change }));

  // The provider whose model a blank field would fall back to.
  const effective: AiProviderId | null = draft.provider || data.resolved;
  const defaultModel = effective ? data.defaultModels[effective] : "";
  const resolvedLabel = data.providers.find((p) => p.id === data.resolved)?.label ?? "none installed";

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await postConventions({ action: "prefs", prefs: draft });
      await mutate();
      toast.success("Conventions settings saved");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-body mb-5 space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium text-text">Mine automatically</span>
          <span className="block text-xs text-text-muted">
            Only on demand: the first time a review starts or a PR is opened in a repo, then again when it has new
            review feedback and hasn&apos;t been mined recently. Nothing runs against repos you haven&apos;t touched. Refresh
            from PRs always works.
          </span>
        </span>
      </label>

      <p className="text-xs text-text-muted">Each run accepts or rejects rules automatically. You can remove an active rule or reinstate a rejected one; your decisions are preserved.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PRs to read per run" hint="Newest first; each run only reads PRs with new feedback.">
          <select className="input w-full text-sm" value={draft.prLimit} onChange={(e) => patch({ prLimit: Number(e.target.value) })}>
            {PR_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="At most one automatic run per repo every">
          <select
            className="input w-full text-sm"
            value={draft.minIntervalHours}
            onChange={(e) => patch({ minIntervalHours: Number(e.target.value) })}
          >
            {INTERVALS.map((i) => (
              <option key={i.hours} value={i.hours}>
                {i.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" hint={`Default follows Setup → AI Provider (today: ${resolvedLabel}).`}>
          <select
            className="input w-full text-sm"
            value={draft.provider}
            onChange={(e) => patch({ provider: e.target.value as ConventionsPrefs["provider"] })}
          >
            <option value="">Default</option>
            {data.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.label}
                {p.available ? "" : " (not installed)"}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Model"
          hint="This reads a lot of review text and writes rules agents will follow — worth a stronger model than the everyday default. Blank uses the provider's own."
        >
          <input
            className="input w-full text-sm font-mono"
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder={defaultModel || "provider default"}
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn btn-primary text-xs" disabled={!dirty || saving} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn btn-ghost text-xs" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
