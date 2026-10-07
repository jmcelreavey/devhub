"use client";
import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { PaseoUpdate } from "@/lib/paseo/update";

export function PaseoUpdateNotice() {
  const { data } = useLive<PaseoUpdate>("/api/paseo/update", { refreshInterval: 60 * 60 * 1000 });
  const [dismissed, setDismissed] = useState<string>();
  if (!data?.canUpdate || !data.installable || dismissed === data.installable) return null;
  return <aside className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-elevated text-sm" role="status">
    <span className="flex-1">Paseo {data.installable} is available.</span>
    <Link className="btn btn-primary" href="/agents?view=connection">View update</Link>
    <button className="hub-icon-btn" aria-label="Dismiss Paseo update" onClick={() => setDismissed(data.installable!)}><X size={14} /></button>
  </aside>;
}
