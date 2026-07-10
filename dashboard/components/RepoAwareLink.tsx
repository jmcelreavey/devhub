"use client";

import type { MouseEvent, ReactNode } from "react";
import { openRepoLinkHref, parseRepoLinkHref } from "@/lib/repo-link";

export function repoLinkLabel(href: string): string | null {
  const target = parseRepoLinkHref(href);
  if (!target) return null;
  return target.path ? `Open ${target.repoName}/${target.path} in Cursor` : `Open ${target.repoName} in Cursor`;
}

export function RepoAwareLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const repoLabel = repoLinkLabel(href);

  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    if (!repoLabel) return;
    event.preventDefault();
    try {
      await openRepoLinkHref(href);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <a
      href={href}
      className={className}
      target={repoLabel ? undefined : "_blank"}
      rel={repoLabel ? undefined : "noopener noreferrer"}
      title={repoLabel ?? undefined}
      onClick={onClick}
      style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "2px" }}
    >
      {children}
    </a>
  );
}
