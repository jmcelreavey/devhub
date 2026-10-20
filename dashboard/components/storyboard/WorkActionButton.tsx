"use client";

import Link from "next/link";
import type { NextAction } from "@/lib/storyboard/next-action";

export function WorkActionButton({ action, pending = false, onAction, onOpen, detailHref, className = "", quiet = false }: {
  action: NextAction;
  pending?: boolean;
  onAction: (action: NextAction) => void;
  onOpen?: () => void;
  detailHref?: string;
  className?: string;
  quiet?: boolean;
}) {
  const classes = `btn ${quiet ? "btn-ghost" : action.kind === "progress" || action.kind === "done" ? "" : "btn-primary"} ${className}`;
  if ("href" in action) {
    if (onOpen) return <Link className={classes} href={detailHref ?? action.href} aria-haspopup="dialog" onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onOpen();
    }}>{action.label}</Link>;
    return action.external ? (
      <a className={classes} href={action.href} target="_blank" rel="noopener noreferrer">{action.label}</a>
    ) : <Link className={classes} href={action.href}>{action.label}</Link>;
  }
  if (action.kind === "start-auto") return <button type="button" className={classes} disabled={pending} title="Auto pauses after planning for your review" onClick={() => onAction({ ...action, pauseAfterPlan: true })} aria-busy={pending || undefined}>{pending ? "Starting…" : action.label}</button>;
  return (
    <button type="button" className={classes} disabled={pending} onClick={() => onAction(action)} aria-busy={pending || undefined}>
      {pending ? "Working…" : action.label}
    </button>
  );
}
