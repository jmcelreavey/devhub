"use client";

import { WorkingFolderField } from "@/components/agents/WorkingFolderField";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { AGENT_HANDOFF_EVENT,agentsHref,handoffPrompt,requestAgentConversation,type AgentHandoff } from "@/lib/agent-handoff";
import type { AionAssistant } from "@/lib/aionui/contracts";
import { useToast } from "@/lib/hooks/use-toast";
import { RotateCw,X } from "lucide-react";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import { useEffect,useRef,useState,type FormEvent,type ReactNode } from "react";

export interface LaunchIntent extends AgentHandoff { requestId: string }

export function AgentLaunchSheet() {
  const [intent, setIntent] = useState<LaunchIntent>();
  const token = useRef<string | undefined>(undefined);
  const router = useRouter();
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AgentHandoff>).detail;
      if (!detail?.title) return;
      token.current = crypto.randomUUID();
      setIntent({ ...detail, requestId: token.current });
    };
    const navigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href?.startsWith("/") && !href.startsWith("//")) router.push(href);
    };
    window.addEventListener(AGENT_HANDOFF_EVENT, open);
    window.addEventListener("devhub:navigate", navigate);
    return () => { window.removeEventListener(AGENT_HANDOFF_EVENT, open); window.removeEventListener("devhub:navigate", navigate); };
  }, [router]);
  if (!intent) return null;
  return <AgentLaunchForm key={intent.requestId} intent={intent} current={() => token.current === intent.requestId} close={() => { token.current = undefined; setIntent(undefined); }} />;
}

export function AgentLaunchForm({ intent, current, close, banner, disabled, disabledReason, resolveCwd, beforeStart, onStarted, onProviderChange }: {
  intent: LaunchIntent; current: () => boolean; close: () => void; banner?: ReactNode;
  disabled?: boolean; disabledReason?: string; resolveCwd?: () => Promise<string | undefined>;
  beforeStart?: () => Promise<void>; onStarted?: () => void; onProviderChange?: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const initialPath = useRef(pathname);
  const [editedPrompt, setPrompt] = useState<string>();
  const prompt = editedPrompt ?? intent.prompt ?? "";
  const [cwd, setCwd] = useState(intent.cwd || "");
  const [repoName, setRepoName] = useState(intent.repoName || "");
  const [assistants, setAssistants] = useState<AionAssistant[]>();
  const [assistantId, setAssistantId] = useState("");
  const [model, setModel] = useState("");
  const [worktree, setWorktree] = useState(intent.worktree ?? intent.kind !== "review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let disposed = false;
    void fetch("/api/aionui/connection").then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.connected) throw new Error(data.error || "Connect your AionUi workspace first.");
      if (disposed) return;
      const rows: AionAssistant[] = data.assistants.filter((a: AionAssistant) => a.enabled);
      setAssistants(rows);
      const preferred = intent.provider === "chatgpt" ? "codex" : intent.provider;
      const saved = localStorage.getItem(`devhub:agent-choice:${intent.stage || intent.kind || "agent"}`);
      const selected = rows.find((a) => a.id === preferred || (preferred && a.agent?.acp_backend === preferred))
        ?? rows.find((a) => a.id === saved) ?? rows.find((a) => a.id === data.defaultAssistantId);
      setAssistantId(selected?.id || "");
      const savedModel = localStorage.getItem(`devhub:agent-model:${intent.stage || intent.kind || "agent"}:${selected?.id}`);
      if (savedModel && selected?.models.includes(savedModel)) setModel(savedModel);
      if (!intent.cwd && !intent.repoName) setCwd(data.defaultCwd || "");
    }).catch((err: unknown) => { if (!disposed) setError(err instanceof Error ? err.message : "Could not load agents."); });
    return () => { disposed = true; };
  }, [intent.provider, intent.cwd, intent.repoName, intent.kind, intent.stage]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const locationAtStart = window.location.href;
    try {
      if (disabled) throw new Error(disabledReason || "This task is not ready to start.");
      await beforeStart?.();
      const folder = cwd.trim() || (await resolveCwd?.());
      if (!folder) throw new Error("Pick a working folder.");
      const response = await fetch("/api/agent/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        provider: assistantId, model: model || undefined, prompt: handoffPrompt(prompt, intent.context, intent.notePath),
        cwd: folder, title: intent.title.slice(0, 80), worktree, requestId: intent.requestId,
        taskId: intent.taskId, taskDate: intent.taskDate, action: intent.stage || intent.kind || "agent",
        repoName: repoName || intent.repoName, notePath: intent.notePath, prUrl: intent.prUrl, headSha: intent.headSha,
        parentRunId: intent.parentRunId, resumeSessionId: intent.resumeSessionId,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the chat.");
      const href = agentsHref(data.run.conversationId, data.run.id);
      localStorage.setItem(`devhub:agent-choice:${intent.stage || intent.kind || "agent"}`, assistantId);
      localStorage.setItem(`devhub:agent-model:${intent.stage || intent.kind || "agent"}:${assistantId}`, model);
      if (data.run.state !== "failed") onStarted?.();
      if (current() && window.location.href === locationAtStart && pathname === initialPath.current) {
        if (data.run.conversationId) requestAgentConversation(data.run.conversationId);
        close(); router.push(href);
      } else toast.info("Your agent is ready in Agents Activity.");
    } catch (err) { if (current()) setError(err instanceof Error ? err.message : "Could not start the chat. Check Activity before retrying."); }
    finally { setBusy(false); }
  }

  const selected = assistants?.find((a) => a.id === assistantId);
  return <dialog ref={dialog} aria-label={intent.title} onCancel={close} className="m-auto max-h-[calc(100dvh-2rem)] overflow-auto bg-bg-elevated text-text rounded-xl border border-border p-0 w-[calc(100%-2rem)] max-w-2xl backdrop:bg-black/50">
    <form onSubmit={submit} className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{intent.title}</h2><button type="button" aria-label="Close handoff" className="btn btn-ghost" onClick={close}><X size={16} /></button></div>
      <p className="text-sm text-text-muted">Choose an agent and review the handoff. The conversation continues in Agents.</p>
      {banner}
      {!assistants && !error && <SkeletonRows count={2} height={40} />}
      {assistants && <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Agent<select className="input w-full mt-1" value={assistantId} onChange={(e) => { setAssistantId(e.target.value); setModel(""); onProviderChange?.(e.target.value); }}>{assistants.map((a) => <option key={a.id} value={a.id} disabled={a.agent_status !== "online"}>{a.name}{a.agent_status !== "online" ? " — needs setup" : ""}</option>)}</select></label>
        <label className="text-sm">Model<select className="input w-full mt-1" value={model} onChange={(e) => setModel(e.target.value)}><option value="">Agent default</option>{selected?.models.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
      </div>}
      <WorkingFolderField
        cwd={cwd}
        repoName={intent.repoName}
        onChange={(next) => { setCwd(next.path); setRepoName(next.name); }}
      />
      <label className="block text-sm">{intent.context ? "What would you like the agent to do?" : "Task"}<textarea className="input w-full mt-1" rows={5} maxLength={32000} value={prompt} onChange={(e) => setPrompt(e.target.value)} required /></label>
      {intent.context && <details open><summary className="text-sm cursor-pointer">Captured terminal context · {intent.context.length.toLocaleString()} characters</summary><pre className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-auto bg-bg-surface p-3 mt-2 rounded">{intent.context}</pre></details>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />Use an isolated worktree</label>
      {error && <div role="alert" className="tone-panel tone-panel--warning text-sm"><p>{error}</p>{!assistants && <Link href="/agents?view=connection" className="underline" onClick={close}>Connect workspace</Link>}</div>}
      {disabled && disabledReason && <p className="text-sm text-text-muted">{disabledReason}</p>}
      <div className="flex items-center justify-end gap-3"><button type="button" className="btn btn-ghost" onClick={close}>{busy ? "Continue in background" : "Cancel"}</button><button type="submit" className="btn btn-primary gap-2" disabled={disabled || busy || selected?.agent_status !== "online"}>{busy && <RotateCw size={14} className="animate-spin" />}{busy ? "Starting…" : "Start chat"}</button></div>
    </form>
  </dialog>;
}
