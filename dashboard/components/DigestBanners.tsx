"use client";

import Link from "next/link";
import { Newspaper, X } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useCallback, useMemo, useState } from "react";

interface DigestEntry {
  id: string;
  createdAt?: string;
  title?: string;
  markdown?: string;
}

interface DigestPayload {
  digests?: DigestEntry[];
  latest?: DigestEntry | null;
}

const DISMISS_KEY = "devhub.digest-banners.dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Scheduled / capability digests as dismissible Today banners. */
export function DigestBanners() {
  const { data } = useLive<DigestPayload>("/api/capability/digest", { refreshInterval: 0 });
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissed(),
  );

  const items = useMemo(() => {
    const list = data?.digests?.length ? data.digests : data?.latest ? [data.latest] : [];
    return list.filter((d) => d?.id && !dismissed.has(d.id)).slice(0, 2);
  }, [data, dismissed]);

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

  if (items.length === 0) return null;

  return (
    <div className="mb-3 space-y-2" aria-label="Digests">
      {items.map((d) => (
        <div
          key={d.id}
          className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text-subtle)" }}
        >
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-1.5 font-semibold" style={{ color: "var(--text)" }}>
              <Newspaper size={13} aria-hidden />
              {d.title ?? "Capability digest"}
            </div>
            {d.markdown ? (
              <p className="line-clamp-2 leading-relaxed">{d.markdown.replace(/^#+\s*/gm, "").slice(0, 180)}</p>
            ) : null}
            <Link href="/radar" className="mt-1 inline-block underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
              Open digest
            </Link>
          </div>
          <button type="button" className="hub-icon-btn shrink-0" aria-label="Dismiss digest" onClick={() => dismiss(d.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
