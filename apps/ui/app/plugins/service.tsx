"use client";

import { useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import type { PluginServiceReview } from "../../../../packages/shared/ui-lib/plugins/model";
import { asFailure, getJson, postJson } from "./api";

export function ServiceControl({ id, available, managed }: { id: string; available: boolean; managed: boolean }) {
  const [review, setReview] = useState<PluginServiceReview | null>(null);
  const [busy, setBusy] = useState<"review" | "approve" | "disable" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const endpoint = `/api/plugins/${encodeURIComponent(id)}/service`;

  async function load() {
    setBusy("review");
    setError(null);
    setMessage(null);
    try { setReview(await getJson<PluginServiceReview>(endpoint)); }
    catch (err) { setReview(null); setError(asFailure(err).message); }
    finally { setBusy(null); }
  }

  async function change(action: "approve" | "disable") {
    if (busy || (action === "approve" && !review)) return;
    setBusy(action);
    setError(null);
    try {
      await postJson(endpoint, action === "approve" ? { action, digest: review!.digest } : { action });
      setReview(null);
      setMessage(action === "approve" ? "Service approved. The primary dashboard will start it." : "Service turned off. The worker will stop.");
    } catch (err) {
      setReview(null);
      setError(asFailure(err).message);
    } finally { setBusy(null); }
  }

  return <section className="mt-4 border-t border-border-muted pt-4" aria-label="Background service">
    <h3 className="text-sm font-semibold text-text">Background service</h3>
    {message ? <p className="mt-2 text-xs text-text-subtle" role="status">{message}</p> : null}
    {error ? <p className="tone-panel tone-panel--danger mt-2 text-xs" role="alert">{error}</p> : null}
    {!available ? <>
      <p className="mt-1 text-xs text-text-subtle">{managed ? "Service review is unavailable while this plugin is disabled or needs attention. You can still turn it off." : "Trust this plugin to review its service."}</p>
      {managed ? <button type="button" className="btn btn-ghost mt-2 text-xs" disabled={busy !== null} onClick={() => void change("disable")}>{busy ? "Turning off…" : "Turn off"}</button> : null}
    </> : <>
      {busy === "review" ? <div className="mt-2" role="status" aria-busy="true"><span className="sr-only">Loading service review</span><SkeletonRows count={2} /></div> : null}
      {busy === "disable" && !review ? <p className="mt-2 text-xs text-text-subtle" role="status">Turning off…</p> : null}
      {review ? <div className="mt-2 space-y-3 text-xs">
        <p><strong>{review.label}</strong> · {review.enabled ? "Approved" : "Off"}</p>
        <p>When approved, the service runs plugin code with your user account while the primary dashboard is open.</p>
        <p>Primary dashboard only; {review.maxRunSeconds}s limit per connection. Reconnects do not replay requests. Replacements need fresh approval.</p>
        <div><p className="font-semibold">Reviewed snapshot digest</p><div className="flex items-start gap-2"><code className="min-w-0 break-all">{review.digest}</code><CopyButton text={review.digest} label="service digest" /></div></div>
        <div className="space-y-3">
          {review.inventory.map((group) => <section key={group.kind} className="rounded-md border border-border-muted p-3">
            <h4 className="font-semibold text-text">{group.kind}</h4>
            {group.entries.map((entry) => <p className="mt-1 break-words text-text-muted" key={entry}>{entry}</p>)}
            {group.note ? <p className="mt-1 text-text-subtle">{group.note}</p> : null}
            {group.more ? <p className="mt-1 text-text-subtle">{group.more} more entries</p> : null}
          </section>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {review.enabled ? <button type="button" className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => void change("disable")}>{busy ? "Turning off…" : "Turn off"}</button>
            : <button type="button" className="btn btn-primary text-xs" disabled={busy !== null} onClick={() => void change("approve")}>{busy ? "Approving…" : "Approve"}</button>}
          <button type="button" className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => setReview(null)}>Close review</button>
        </div>
      </div> : !busy ? <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={() => void load()}>{error ? "Try again" : "Review service"}</button>
        {error ? <button type="button" className="btn btn-ghost text-xs" onClick={() => void change("disable")}>Turn off</button> : null}
      </div> : null}
    </>}
  </section>;
}
