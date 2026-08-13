"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { fullResolutionAvatarUrl, trustedAvatarUrl } from "@/lib/people/avatar-trust";

export { fullResolutionAvatarUrl, trustedAvatarUrl } from "@/lib/people/avatar-trust";

/**
 * Palette for the initials fallback. Deliberately not the lane palette: a lane
 * colour says "this branch", and reusing it for a person would make two
 * unrelated facts look related.
 */
const AVATAR_COLORS = [
  "#5b7cfa",
  "#c2643a",
  "#8c5bd0",
  "#3f8f5c",
  "#c04f6b",
  "#2f8f8c",
  "#a8802c",
  "#6a6fb5",
];

/** Cheap, stable string hash — only used to pick a colour, never for identity. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Up to two initials. Prefers the display name, falls back to the local part of
 * the email, because "J" beats an empty circle and "gocampos" still gives "GO".
 */
export function initialsOf(author: string, email: string): string {
  const local = email.split("@")[0] ?? "";
  // GitHub noreply addresses are "12345+name@..." — the digits are not a name.
  const fromEmail = local.replace(/^\d+\+/, "").replace(/[._-]+/g, " ").trim();
  const source = author.trim() || fromEmail;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function avatarColor(seed: string): string {
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length]!;
}

/**
 * GitHub's noreply addresses carry the account in the address itself, in two
 * shapes: `12345+login@users.noreply.github.com` (post-2017, numeric id) and
 * the older bare `login@users.noreply.github.com`. Both resolve to an avatar
 * with no API call and no rate limit, which is why this is tried before
 * Gravatar — on a GitHub-hosted repo it is a far better hit rate.
 *
 * The login arrives lowercased, since the log parser lowercases the whole
 * address to make it a stable map key. That is fine: GitHub profile URLs are
 * case-insensitive. The numeric form avoids the question entirely.
 */
export function githubAvatarUrl(email: string, size: number): string | null {
  const match = /^(?:(\d+)\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/.exec(email.trim());
  if (!match) return null;
  const [, id, login] = match;
  const px = size * 2;
  return id
    ? `https://avatars.githubusercontent.com/u/${id}?s=${px}`
    : `https://github.com/${login}.png?size=${px}`;
}

/**
 * Gravatar addresses an account by the SHA-256 of its lowercased, trimmed
 * email. Returns null when there is no email to hash, or when the crypto
 * subtle API is unavailable (it requires a secure context, which a plain-http
 * LAN address is not) — both cases fall through to initials.
 */
async function gravatarUrl(email: string, size: number): Promise<string | null> {
  const address = email.trim().toLowerCase();
  if (!address || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // d=404 rather than a default image: a third-party placeholder would look
  // like a real avatar and hide the fact that this person has no Gravatar. A
  // 404 lets the img fail so the local initials show instead.
  return `https://www.gravatar.com/avatar/${hex}?s=${px(size)}&d=404`;
}

function px(size: number): number {
  return size * 2;
}

/**
 * Ordered avatar candidates, best hit rate first:
 * 1. `resolved` — trusted CDN from identity / parent (GitHub attribution or
 *    Atlassian from Jira)
 * 2. GitHub noreply-derived URL
 * 3. Gravatar
 * 4. initials (rendered underneath)
 */
async function avatarSources(
  email: string,
  size: number,
  resolved?: string,
): Promise<string[]> {
  const sources = [
    resolved ? trustedAvatarUrl(resolved, size) : null,
    githubAvatarUrl(email, size),
    await gravatarUrl(email, size),
  ];
  return [...new Set(sources.filter((url): url is string => Boolean(url)))];
}

/**
 * Author avatar for a history row.
 *
 * The initials disc is always rendered underneath; a remote image sits on top
 * and steps to the next candidate if it fails, falling back to the disc once
 * they are exhausted. That ordering is what keeps this usable offline and free
 * of layout shift — there is never a frame with no avatar, and a failed fetch
 * degrades to something that still identifies the author.
 *
 * The initials are drawn as SVG text rather than laid out as HTML. Flex
 * centring aligns the line box, not the glyphs, so two capitals sat visibly
 * high in the disc; `dominant-baseline: central` in a fixed viewBox centres on
 * the glyph box itself and stays centred at any size.
 */
export function CommitAvatar({
  author,
  email,
  size = 18,
  title,
  resolvedUrl,
  enlargeable = false,
}: {
  author: string;
  email: string;
  size?: number;
  title?: string;
  /** Trusted CDN avatar (GitHub attribution, Jira / Atlassian assignee, …). */
  resolvedUrl?: string;
  /** Click opens a full-res photo. No-op while only initials are showing. */
  enlargeable?: boolean;
}) {
  // Both bits of state carry the email they belong to, rather than being
  // cleared by the effect: resetting them synchronously would mean a cascading
  // render on every row, and this way a digest that resolves after the email
  // changed is simply ignored.
  //
  // Failures are also keyed on the candidate list. Graph rows mount before
  // `/git/people` returns, try Gravatar, 404, and used to keep that miss when
  // the GitHub/Atlassian URL arrived — so the list stayed on initials while a
  // later-mounted detail avatar (people map already in hand) showed the photo.
  const [resolved, setResolved] = useState<{ email: string; urls: string[] } | null>(null);
  const [failed, setFailed] = useState<{ email: string; srcKey: string; count: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ email: string; src: string } | null>(null);
  const [fullFailed, setFullFailed] = useState<{ email: string; src: string } | null>(null);

  useEffect(() => {
    let live = true;
    void avatarSources(email, size, resolvedUrl).then((urls) => {
      if (live) setResolved({ email, urls });
    });
    return () => {
      live = false;
    };
  }, [email, size, resolvedUrl]);

  const urls = resolved?.email === email ? resolved.urls : [];
  const srcKey = urls.join("\0");
  const failures = failed?.email === email && failed.srcKey === srcKey ? failed.count : 0;
  const src = urls[failures] ?? null;
  // Keyed like `resolved`/`failed` so a row that recycles onto another author
  // does not keep the previous lightbox or a stale full-res 404 — no reset effect.
  const lightboxOpen = Boolean(src && lightbox?.email === email && lightbox.src === src);
  const fullResFailed = Boolean(src && fullFailed?.email === email && fullFailed.src === src);

  const seed = email || author;
  const initials = initialsOf(author, email);
  const fullSrc = src ? fullResolutionAvatarUrl(src) ?? src : null;
  const canEnlarge = enlargeable && Boolean(fullSrc);

  const disc = (
    <>
      <svg viewBox="0 0 32 32" width={size} height={size} focusable="false">
        <circle cx="16" cy="16" r="16" fill={avatarColor(seed)} />
        <text
          x="16"
          y="16"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={initials.length > 1 ? 14 : 16}
          fontWeight="600"
          fill="#fff"
        >
          {initials}
        </text>
      </svg>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- remote hosts, and next/image would proxy every author through the optimiser
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="repo-git-avatar-img"
          onError={() => setFailed({ email, srcKey, count: failures + 1 })}
        />
      )}
    </>
  );

  if (canEnlarge && fullSrc) {
    return (
      <>
        <button
          type="button"
          className="repo-git-avatar repo-git-avatar-zoom"
          style={{ width: size, height: size }}
          title={title ?? `View photo of ${author}`}
          aria-label={`View photo of ${author}`}
          onClick={() => {
            if (src) setLightbox({ email, src });
          }}
        >
          {disc}
        </button>
        <ModalShell
          open={lightboxOpen}
          onClose={() => setLightbox(null)}
          title={author}
          description={email || undefined}
          maxWidth="max-w-md"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- same remote CDN hosts as the thumbnail */}
          <img
            src={fullResFailed && src ? src : fullSrc}
            alt={author}
            className="repo-git-avatar-full"
            referrerPolicy="no-referrer"
            onError={() => {
              // Jira only advertises 16/24/32/48, so N512x512 404s. The
              // thumbnail already loaded — show that rather than a broken img.
              if (!fullResFailed && src) setFullFailed({ email, src });
            }}
          />
        </ModalShell>
      </>
    );
  }

  return (
    <span
      className="repo-git-avatar"
      style={{ width: size, height: size }}
      title={title ?? author}
      aria-hidden
    >
      {disc}
    </span>
  );
}
