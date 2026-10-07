"use client";
import { useCallback, useEffect, useState } from "react";
import { FetchError } from "@/components/ui/FetchError";
import styles from "./WorktreesPanel.module.css";
import Link from "next/link";
import { useToast } from "@/lib/hooks/use-toast";
import type { WorktreeReport } from "@/lib/repos/worktree-report";
interface ReviewJob { id: string; script?: string; enabled: boolean }
export function WorktreeSchedule() {
  const toast = useToast();
  const [job, setJob] = useState<ReviewJob | null>(null);
  const [report, setReport] = useState<WorktreeReport | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setError(null); setAttempt((value) => value + 1); }, []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void Promise.all([fetch("/api/jobs", { signal: controller.signal }), fetch("/api/repos/worktree-report", { signal: controller.signal })]).then(async ([jobsResponse, reportResponse]) => {
      if (!jobsResponse.ok || !reportResponse.ok) throw new Error("Could not load weekly worktree review");
      const jobs = await jobsResponse.json() as { jobs: ReviewJob[] };
      const latest = await reportResponse.json() as { report: WorktreeReport | null };
      if (!disposed) { setJob(jobs.jobs.find((item) => item.script === "worktree_cleanup_scan") ?? null); setReport(latest.report); setReady(true); }
    }).catch((error: unknown) => {
      if (!disposed) setError(controller.signal.aborted ? "Weekly review timed out. Try again." : error instanceof Error ? error.message : "Could not load review");
    }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch(job ? `/api/jobs/${job.id}` : "/api/jobs", {
        method: job ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job ? { enabled: !job.enabled, source: "ui" } : {
          name: "Weekly worktree review", script: "worktree_cleanup_scan", cron: "0 9 * * 1", enabled: true, wake: false, source: "ui",
        }),
      });
      const result = await response.json() as ReviewJob & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update schedule");
      setJob(result);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update schedule"); }
    finally { setBusy(false); }
  }
  return <details className={styles.support}>
    <summary>Weekly review <span className="badge badge-muted">{error ? "Unavailable" : !ready ? "Loading…" : job?.enabled ? "On" : "Off"}</span></summary>
    <div className={styles.detailsBody}>
    {error && <FetchError message={error} onRetry={retry} bare />}
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn btn-ghost" type="button" disabled={!ready || busy} onClick={() => void toggle()}>{job?.enabled ? "Disable weekly review" : "Enable weekly review"}</button>
      <span>Mondays at 09:00 on this computer. Reports only; nothing is deleted.</span>
      <Link href="/actions" className="hover:underline">Manage schedules and run now</Link>
    </div>
    {report && <div>Last report: {new Date(report.scannedAt).toLocaleString()} · {report.repositories.reduce((sum, repo) => sum + repo.candidates, 0)} suggested checkouts{report.errors.length ? ` · ${report.errors.length} repositories could not be checked` : ""}
      <div className="flex flex-wrap gap-3">{report.repositories.filter((repo) => repo.candidates).map((repo) => <Link key={repo.name} href={repo.href} className="hover:underline">{repo.name}: {repo.candidates}</Link>)}</div>
    </div>}
    </div>
  </details>;
}
