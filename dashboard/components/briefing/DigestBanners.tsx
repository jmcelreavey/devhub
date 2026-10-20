"use client";

import Link from "next/link";
import { Newspaper, X } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useCallback, useMemo, useState } from "react";

interface DigestEntry {
  id: string;
  createdAt?: string;
  title?: string;
  headline?: string;
  markdown?: string;
  counts?: { added?: number; spread?: number; removed?: number };
}

interface DigestPayload {
  digests?: DigestEntry[];
  latest?: DigestEntry | null;
}

const DISMISS_KEY = "devhub.digest-banners.dismissed";
export const RADAR_DIGEST_HREF = "/radar#this-week";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** The digest's own headline, or its first heading, as plain text (no markdown marks). */
function headlineOf(digest: DigestEntry): string {
  const raw = digest.headline ?? digest.markdown?.match(/^#+\s*(.+)$/m)?.[1] ?? digest.title ?? "";
  return raw.replace(/\*\*|__|`/g, "").trim();
}

function countsLine(counts: DigestEntry["counts"]): string {
  if (!counts) return "";
  const parts = [
    counts.added ? `${counts.added} new` : "",
    counts.spread ? `${counts.spread} spreading` : "",
    counts.removed ? `${counts.removed} removed` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Only the newest digest. Each one is "This week: …", so an older one under it reads as a
 * second, contradictory this-week; and dismissing the newest must not resurface last week's.
 */
export function digestBanner(payload: DigestPayload | undefined, dismissed: Set<string>) {
  const newest = payload?.latest ?? payload?.digests?.[0];
  if (!newest?.id || dismissed.has(newest.id)) return null;
  const created = newest.createdAt ? new Date(newest.createdAt) : null;
  const date = created && !Number.isNaN(created.getTime())
    ? created.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "";
  return { id: newest.id, headline: headlineOf(newest), date, counts: countsLine(newest.counts) };
}

/** The weekly capability digest as one dismissible Today banner. */
export function DigestBanners() {
  const { data } = useLive<DigestPayload>("/api/capability/digest", { refreshInterval: 0 });
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissed(),
  );

  const banner = useMemo(() => digestBanner(data, dismissed), [data, dismissed]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (!banner) return null;

  return (
    <div className="mb-3" aria-label="Digests">
      <div
        className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text-subtle)" }}
      >
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-text">
            <Newspaper size={13} aria-hidden />
            Capability digest{banner.date ? ` · ${banner.date}` : ""}
          </div>
          {banner.headline ? <p className="truncate leading-relaxed">{banner.headline}</p> : null}
          {banner.counts ? <p className="leading-relaxed">{banner.counts}</p> : null}
          <Link href={RADAR_DIGEST_HREF} className="mt-1 inline-block underline-offset-2 hover:underline text-accent">
            Open digest
          </Link>
        </div>
        <button type="button" className="hub-icon-btn shrink-0" aria-label="Dismiss digest" onClick={() => dismiss(banner.id)}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
