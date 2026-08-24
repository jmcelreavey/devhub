"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Hash, Pencil } from "lucide-react";
import { defaultHrefForRef, type EntityRef } from "@/lib/entity-note";
import { useLive } from "@/lib/hooks/use-fetch";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";

interface TagLookupPayload {
  tag: string;
  tasks: { date: string; id: string; text: string; done: boolean }[];
  notes: { title: string; href: string }[];
  related: EntityRef[];
}

const TAG_TOKEN_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * "Where else does this tag show up" — notes, docs, PRs and Jira keys tied to
 * the tag, above the filtered task queue. Also hosts the rename control: tags
 * are derived from text, so a rename is a bounded rewrite across the vault.
 */
export function TagContextCard({ tag }: { tag: string }) {
  const { data } = useLive<TagLookupPayload>(`/api/tags/${encodeURIComponent(tag)}`);
  const prompt = usePrompt();
  const toast = useToast();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);

  if (!tag || TAG_TOKEN_RE.test(tag) === false) return null;
  const notes = data?.notes ?? [];
  const related = data?.related ?? [];
  const taskCount = data?.tasks.length ?? 0;
  if (!data || (notes.length === 0 && related.length === 0 && taskCount === 0)) return null;

  async function rename() {
    const to = await prompt({
      title: `Rename #${tag}`,
      message: "Rewrites this tag across all tasks and notes.",
      confirmLabel: "Rename",
      input: { placeholder: "new-tag-name", defaultValue: tag },
    });
    const next = to?.trim().toLowerCase();
    if (!next || next === tag) return;
    if (!TAG_TOKEN_RE.test(next)) {
      toast.error("Tags are lowercase letters/digits/-/_ starting with a letter or _");
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch("/api/tags/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: tag, to: next }),
      });
      const json = (await res.json()) as { filesChanged?: number; replacements?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Rename failed");
      toast.success(
        `Renamed to #${next} — ${json.replacements ?? 0} occurrence${(json.replacements ?? 0) === 1 ? "" : "s"} in ${json.filesChanged ?? 0} file${(json.filesChanged ?? 0) === 1 ? "" : "s"}.`,
      );
      router.replace(`/work?tag=${encodeURIComponent(next)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenaming(false);
    }
  }

  return (
    <section className="card card-body tag-context" aria-label={`Context for #${tag}`}>
      <div className="tag-context-head">
        <Hash size={13} aria-hidden />
        <strong>#{tag}</strong>
        <span className="text-text-subtle">
          {taskCount} tagged task{taskCount === 1 ? "" : "s"} in the queue below
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={renaming}
          style={{ marginLeft: "auto", padding: "2px 6px" }}
          onClick={() => void rename()}
          title="Rewrite this tag across all tasks and notes"
        >
          <Pencil size={11} aria-hidden /> Rename
        </button>
      </div>
      {notes.length > 0 && (
        <div className="tag-context-group">
          <span className="tag-context-label">Notes & docs</span>
          <ul>
            {notes.map((note) => (
              <li key={note.href}>
                <Link href={note.href} className="entity-link-chip" data-kind="note">
                  <FileText size={10} aria-hidden />
                  <span>{note.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {related.length > 0 && (
        <div className="tag-context-group">
          <span className="tag-context-label">Related work</span>
          <ul>
            {related.map((ref) => {
              const href = defaultHrefForRef(ref);
              const body = (
                <>
                  <span className="entity-rel-kind">{ref.kind}</span>
                  <span>{ref.label}</span>
                </>
              );
              return (
                <li key={`${ref.kind}:${ref.id}`}>
                  {href ? (
                    <a
                      href={href}
                      {...(/https?:/i.test(href)
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="entity-link-chip"
                      data-kind={ref.kind}
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="entity-link-chip" data-kind={ref.kind}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
