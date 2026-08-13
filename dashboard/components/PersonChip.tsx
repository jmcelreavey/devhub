"use client";

import { useEffect, useState } from "react";
import { CommitAvatar } from "@/components/repo-git/CommitAvatar";
import { trustedAvatarUrl } from "@/lib/people/avatar-trust";

/** Client-side memo so calendar rows sharing an organizer don't stampede. */
const atlassianByEmail = new Map<string, Promise<string | null>>();

function lookupAtlassianAvatar(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase();
  if (!key || key.endsWith("@users.noreply.github.com")) return Promise.resolve(null);
  if (typeof fetch !== "function") return Promise.resolve(null);

  let pending = atlassianByEmail.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(`/api/people/avatar?email=${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const data = (await res.json()) as { url?: unknown };
        return typeof data.url === "string" ? data.url : null;
      } catch {
        return null;
      }
    })();
    atlassianByEmail.set(key, pending);
  }
  return pending;
}

/**
 * Compact avatar + name for list rows (PRs, Jira, calendar, …).
 * Reuses CommitAvatar's chain. When the parent did not pass an avatar URL but
 * we have an email, resolves Atlassian (Jira) via `/api/people/avatar`.
 */
export function PersonChip({
  name,
  email = "",
  avatarUrl,
  size = 18,
  className,
  nameClassName,
}: {
  name: string;
  email?: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  nameClassName?: string;
}) {
  const label = name.trim() || email.trim();
  const [atlassian, setAtlassian] = useState<{ email: string; url: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (avatarUrl || !email.trim()) return;
    const key = email.trim();
    let live = true;
    void lookupAtlassianAvatar(key).then((url) => {
      if (!live) return;
      setAtlassian({ email: key, url: url ? trustedAvatarUrl(url, size) : null });
    });
    return () => {
      live = false;
    };
  }, [avatarUrl, email, size]);

  const atlassianUrl =
    !avatarUrl && atlassian && atlassian.email === email.trim() ? atlassian.url : null;

  if (!label && !avatarUrl) return null;

  return (
    <span
      className={["inline-flex min-w-0 max-w-full items-center gap-1.5", className]
        .filter(Boolean)
        .join(" ")}
    >
      <CommitAvatar
        author={label || "?"}
        email={email}
        size={size}
        resolvedUrl={avatarUrl ?? atlassianUrl ?? undefined}
        title={email ? `${label} <${email}>` : label}
      />
      {label ? (
        <span
          className={["min-w-0 truncate", nameClassName ?? "text-[11px] leading-tight text-text-muted"]
            .filter(Boolean)
            .join(" ")}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
