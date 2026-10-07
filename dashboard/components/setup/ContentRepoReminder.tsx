"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";

/**
 * A dismissible strip on Today: your notes and tasks are only on this PC. Shown
 * once, after setup, until a private repo is connected or the user says Not now.
 */
export function ContentRepoReminder() {
  const { data, mutate } = useLive<{ contentRepoReminder?: boolean }>("/api/desktop/first-run", { refreshInterval: 0 });
  const [failed, setFailed] = useState(false);
  if (!data?.contentRepoReminder) return null;

  async function dismiss() {
    setFailed(false);
    try {
      const response = await fetch("/api/desktop/first-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentRepoReminderDismissed: true }) });
      if (!response.ok) throw new Error("save failed");
      await mutate();
    } catch { setFailed(true); }
  }

  return <div className="tone-panel tone-panel--accent flex flex-wrap items-center gap-3 px-4 py-3 text-sm" role="status">
    <p className="flex-1 min-w-[16rem]">Your notes and tasks are stored only on this PC. A private GitHub repo gives them a backup and a history. It&apos;s optional.</p>
    <Link href="/setup?step=github" className="btn btn-primary">Set up private repo</Link>
    <button type="button" className="btn btn-ghost" onClick={() => void dismiss()}>Not now</button>
    {failed && <span role="alert" className="text-danger text-xs">Couldn&apos;t save that. Try again.</span>}
  </div>;
}
