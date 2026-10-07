"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PaseoConnection } from "./paseo-connection";
import Usage from "./usage";

export default function AgentsPage() {
  const params = useSearchParams();
  const requestedView = params.get("view");
  const view = requestedView === "connection" || requestedView === "usage" ? requestedView : "chats";
  return <div>
    <header className="flex items-center gap-4 px-5 border-b border-border" style={{ height: 57 }}>
      <h1 className="text-sm font-semibold mr-2">Agents</h1>
      {[["chats", "Chats"], ["usage", "Usage"], ["connection", "Connection"]].map(([id, label]) => <Link key={id} href={id === "chats" ? "/agents" : `/agents?view=${id}`} className={view === id ? "text-sm text-accent" : "text-sm text-text-muted"} aria-current={view === id ? "page" : undefined}>{label}</Link>)}
    </header>
    {view === "usage" && <Usage />}
    {view === "connection" && <PaseoConnection />}
  </div>;
}
