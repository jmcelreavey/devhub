"use client";
import { openAgentHandoff } from "@/lib/agent-handoff";

import type { RepoInfo } from "@/app/repos/types";
import type { useReposActions } from "@/app/repos/useReposActions";
import { repoShortcutFromEvent } from "@/lib/app-shortcuts";
import { isTypingTarget } from "@/lib/konami-sequence";
import { Bot,Code2,Rocket,TerminalSquare } from "lucide-react";
import { useEffect,useLayoutEffect,useRef } from "react";

function isKeepAliveHidden(node: HTMLElement | null): boolean {
  const panel = node?.closest("[data-workspace-tab-panel]");
  if (!(panel instanceof HTMLElement)) return false;
  return panel.hidden || panel.inert;
}

export function RepoActionBar({
  repo,
  actions,
}: {
  repo: RepoInfo;
  actions: ReturnType<typeof useReposActions>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const repoRef = useRef(repo);
  const openUpstartRef = useRef(actions.openUpstart);
  const openInTerminalRef = useRef(actions.openInTerminal);
  useLayoutEffect(() => {
    repoRef.current = repo;
    openUpstartRef.current = actions.openUpstart;
    openInTerminalRef.current = actions.openInTerminal;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const chord = repoShortcutFromEvent(e);
      if (!chord) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (document.querySelector('[aria-label="Command palette"]')) return;
      if (isKeepAliveHidden(rootRef.current)) return;
      e.preventDefault();
      if (chord === "upstart") void openUpstartRef.current(repoRef.current);
      else openInTerminalRef.current(repoRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="btn btn-ghost text-xs" title="Terminal ⌘⇧T" onClick={() => actions.openInTerminal(repo)}><TerminalSquare size={13} />Terminal</button>
      <button type="button" className="btn btn-ghost text-xs" onClick={() => void actions.openInCursor(repo.name)}><Code2 size={13} />Editor</button>
      <button type="button" className="btn btn-ghost text-xs" onClick={() => openAgentHandoff({ title: "Ask Agent · " + repo.name, cwd: repo.path, repoName: repo.name, worktree: false })}><Bot size={13} />Agents</button>
      <button
        type="button"
        className="btn btn-ghost text-xs"
        onClick={() => void actions.openUpstart(repo)}
        aria-label="Run upstart"
        title="Upstart ⌘⏎"
      >
        <Rocket size={13} aria-hidden />
        Upstart
      </button>
    </div>
  );
}
