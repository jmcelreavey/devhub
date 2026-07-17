"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bot, Copy, X } from "lucide-react";
import {
  hookFailureTitle,
  type GitHookFailurePayload,
} from "@/lib/git-hook-failure";
import { agentGitHookFailureCommand, openTerminal } from "@/lib/terminal-launch";
import { useToast } from "@/lib/use-toast";

interface GitHookFailureDialogProps {
  failure: GitHookFailurePayload | null;
  repoName: string;
  repoPath: string;
  onClose: () => void;
}

export function GitHookFailureDialog({
  failure,
  repoName,
  repoPath,
  onClose,
}: GitHookFailureDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const toast = useToast();
  const [launching, setLaunching] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!failure) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      previousFocus.current?.focus?.();
    };
  }, [failure, onClose]);

  if (!failure) return null;

  const title = hookFailureTitle(failure);

  async function resolveWithAi() {
    setLaunching(true);
    try {
      openTerminal({
        cwd: repoPath,
        label: `fix ${failure!.hook ?? "hook"} · ${repoName}`,
        command: await agentGitHookFailureCommand({
          repoName,
          hook: failure!.hook,
          phase: failure!.phase,
          logPath: failure!.logPath,
        }),
      });
      toast.info("Fixing the hook failure in the terminal.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open agent");
    } finally {
      setLaunching(false);
    }
  }

  async function copyLog() {
    if (!failure) return;
    try {
      await navigator.clipboard.writeText(failure.output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success("Copied hook log");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div
      className="repo-git-hook-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="repo-git-hook-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="repo-git-hook-header">
          <div className="repo-git-hook-title-block">
            <p className="repo-git-hook-eyebrow">Git hook</p>
            <h2 id={titleId} className="repo-git-hook-title">
              {title}
            </h2>
            {failure.summary && failure.summary !== title ? (
              <p className="repo-git-hook-summary">{failure.summary}</p>
            ) : null}
            {failure.logPath ? (
              <p className="repo-git-hook-logpath">
                Full log: <span className="font-mono">{failure.logPath}</span>
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost repo-git-close"
            aria-label="Dismiss"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <pre className="repo-git-hook-log" tabIndex={0}>
          {failure.output}
        </pre>

        <footer className="repo-git-hook-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Dismiss
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void copyLog()}>
            <Copy size={12} aria-hidden />
            {copied ? "Copied" : "Copy log"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={launching}
            onClick={() => void resolveWithAi()}
          >
            <Bot size={13} aria-hidden />
            {launching ? "Opening…" : "Resolve with AI"}
          </button>
        </footer>
      </div>
    </div>
  );
}
