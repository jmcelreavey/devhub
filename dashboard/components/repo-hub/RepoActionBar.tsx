"use client";

import { Bot, Code2, MessageSquare, Monitor, Rocket, Sparkles, TerminalSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLaunchChamberDesktop } from "@/lib/launch/chamber";
import { useLaunchChatGPTDesktop } from "@/lib/launch/chatgpt";
import { useLaunchClaudeDesktop } from "@/lib/launch/claude";
import { useLaunchCursorDesktop } from "@/lib/launch/cursor";
import { repoShortcutFromEvent } from "@/lib/app-shortcuts";
import { isTypingTarget } from "@/lib/konami-sequence";
import {
  antigravityCliCommand,
  chatgptCliCommand,
  claudeCliCommand,
  cursorCliCommand,
  opencodeCliCommand,
  openTerminal,
} from "@/lib/terminal-launch";
import { SplitLaunchButton } from "./SplitLaunchButton";
import type { RepoInfo } from "@/app/repos/types";
import type { useReposActions } from "@/app/repos/useReposActions";

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
  const launchCursorApp = useLaunchCursorDesktop();
  const launchChamber = useLaunchChamberDesktop();
  const launchClaudeApp = useLaunchClaudeDesktop();
  const launchChatGPTApp = useLaunchChatGPTDesktop();
  const rootRef = useRef<HTMLDivElement>(null);
  const repoRef = useRef(repo);
  const openUpstartRef = useRef(actions.openUpstart);
  const openInTerminalRef = useRef(actions.openInTerminal);
  useLayoutEffect(() => {
    repoRef.current = repo;
    openUpstartRef.current = actions.openUpstart;
    openInTerminalRef.current = actions.openInTerminal;
  });

  const openCli = (label: string, command: string) => {
    openTerminal({ cwd: repo.path, label: `${label} · ${repo.name}`, command, repoName: repo.name });
  };

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
      <SplitLaunchButton
        label="Terminal"
        icon={<TerminalSquare size={13} />}
        primaryTitle="Terminal ⌘⇧T"
        onPrimary={() => actions.openInTerminal(repo)}
        items={[
          {
            id: "claude-cli",
            label: "Claude",
            description: "Claude Code CLI in this repo",
            icon: <Bot size={13} />,
            onSelect: () => openCli("Claude", claudeCliCommand()),
          },
          {
            id: "chatgpt-cli",
            label: "ChatGPT",
            description: "Codex CLI in this repo",
            icon: <MessageSquare size={13} />,
            onSelect: () => openCli("ChatGPT", chatgptCliCommand()),
          },
          {
            id: "antigravity-cli",
            label: "Antigravity",
            description: "agy CLI in this repo (yolo)",
            icon: <Sparkles size={13} />,
            onSelect: () => openCli("Antigravity", antigravityCliCommand()),
          },
          {
            id: "cursor-cli",
            label: "Cursor",
            description: "Cursor Agent CLI in this repo",
            icon: <Code2 size={13} />,
            onSelect: () => openCli("Cursor", cursorCliCommand()),
          },
          {
            id: "opencode-cli",
            label: "OpenCode",
            description: "OpenCode CLI in this repo",
            icon: <Monitor size={13} />,
            onSelect: () => openCli("OpenCode", opencodeCliCommand()),
          },
        ]}
      />
      <SplitLaunchButton
        label="IDE"
        icon={<Code2 size={13} />}
        onPrimary={() => void actions.openInCursor(repo.name)}
        items={[
          {
            id: "cursor-agents",
            label: "Cursor",
            description: "Cursor desktop app (Agents)",
            icon: <Code2 size={13} />,
            onSelect: () => void launchCursorApp(),
          },
          {
            id: "chamber",
            label: "OpenChamber",
            description: "OpenChamber desktop app",
            icon: <Monitor size={13} />,
            onSelect: () => void launchChamber(),
          },
          {
            id: "claude-app",
            label: "Claude",
            description: "Claude desktop app",
            icon: <Bot size={13} />,
            onSelect: () => void launchClaudeApp(),
          },
          {
            id: "chatgpt-app",
            label: "ChatGPT",
            description: "ChatGPT desktop app",
            icon: <MessageSquare size={13} />,
            onSelect: () => void launchChatGPTApp(),
          },
        ]}
      />
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
