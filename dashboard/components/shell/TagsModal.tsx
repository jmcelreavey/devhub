"use client";

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Hash, Link2, Plus, X } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { KIND_ICON } from "@/components/EntityLinkChips";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { defaultHrefForRef, type EntityKind, type EntityRef } from "@/lib/entity-note";

export const TAG_KIND_DESCRIPTION: Partial<Record<EntityKind, string>> = {
  tag: "Hashtag",
  task: "Linked task",
  note: "Linked note",
  pr: "Linked PR",
  jira: "Linked Jira ticket",
  calendar: "Linked event",
  meeting: "Linked event",
  diagram: "Linked diagram",
  repo: "Linked repo",
};

function goTo(router: ReturnType<typeof useRouter>, dest: string | null | undefined) {
  if (!dest) return;
  if (/^https?:\/\//i.test(dest)) {
    window.open(dest, "_blank", "noopener,noreferrer");
  } else {
    router.push(dest);
  }
}

function refLabel(ref: EntityRef): string {
  if (ref.kind === "tag") return ref.label ?? `#${ref.id}`;
  return ref.label || ref.id;
}

/**
 * Everything a row is tagged with / linked to. Header shows which entity
 * you're looking at (type icon + name). Add/remove live here so the
 * context menu doesn't grow a second "link" entry.
 */
export function TagsModal({
  open,
  onClose,
  kind,
  title,
  subtitle,
  refs,
  onAddTag,
  onRemoveRef,
  onAddLink,
  onTagContextMenu,
}: {
  open: boolean;
  onClose: () => void;
  kind?: EntityKind;
  /** Header — usually the row title or `#tag`. */
  title?: string;
  subtitle?: string;
  refs: EntityRef[];
  onAddTag?: (tag: string) => void | Promise<void>;
  onRemoveRef?: (ref: EntityRef) => void | Promise<void>;
  onAddLink?: () => void;
  onTagContextMenu?: (e: MouseEvent, ref: EntityRef) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<EntityRef>();
  const [jiraStateKey, setJiraStateKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimisticTags, setOptimisticTags] = useState<string[]>([]);
  const HeaderIcon = kind ? (KIND_ICON[kind] ?? Hash) : Hash;
  const heading = title?.trim() || "Tags";

  const handleClose = () => {
    setOptimisticTags([]);
    onClose();
  };

  const parentKeys = new Set(refs.map((r) => `${r.kind}:${r.id}`));
  const shownRefs: EntityRef[] = [
    ...refs,
    ...optimisticTags
      .filter((tag) => !parentKeys.has(`tag:${tag}`))
      .map((tag) => ({
        kind: "tag" as const,
        id: tag,
        label: `#${tag}`,
        href: `/work?tag=${encodeURIComponent(tag)}`,
      })),
  ];

  const submitTag = async () => {
    const tag = draft.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || !onAddTag || busy) return;
    setBusy(true);
    try {
      await onAddTag(tag);
      setOptimisticTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      icon={<HeaderIcon size={16} />}
      title={heading}
      description={subtitle}
      maxWidth="max-w-sm"
    >
      {shownRefs.length > 0 ? (
        <ul className="tags-modal-list">
          {shownRefs.map((ref) => {
            const Icon = KIND_ICON[ref.kind] ?? Hash;
            const dest = ref.href ?? defaultHrefForRef(ref);
            const label = refLabel(ref);
            return (
              <li key={`${ref.kind}:${ref.id}`}>
                <div className="tags-modal-row">
                  <button
                    type="button"
                    className="tags-modal-item"
                    onClick={() => {
                      handleClose();
                      goTo(router, dest);
                    }}
                    onContextMenu={(e) => {
                      if (onTagContextMenu) {
                        onTagContextMenu(e, ref);
                        return;
                      }
                      menu.openAt(e, ref);
                    }}
                  >
                    <Icon size={13} aria-hidden className="tags-modal-item-icon" />
                    <span className="tags-modal-item-copy">
                      <span className="tags-modal-item-label">{label}</span>
                      <span className="tags-modal-item-desc">{TAG_KIND_DESCRIPTION[ref.kind] ?? "Related"}</span>
                    </span>
                  </button>
                  {onRemoveRef ? (
                    <button
                      type="button"
                      className="tags-modal-remove"
                      aria-label={`Remove ${label}`}
                      disabled={busy}
                      onClick={() => {
                        void onRemoveRef(ref);
                        if (ref.kind === "tag") {
                          setOptimisticTags((prev) => prev.filter((t) => t !== ref.id));
                        }
                      }}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tags-modal-empty">Nothing tagged yet.</p>
      )}

      {(onAddTag || onAddLink) && (
        <div className="tags-modal-add">
          {onAddTag ? (
            <form
              className="search-field search-field--boxed tags-modal-add-field"
              onSubmit={(e) => {
                e.preventDefault();
                void submitTag();
              }}
            >
              <Hash size={14} aria-hidden className="search-field__icon" />
              <input
                className="search-field__input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a tag…"
                aria-label="Add a tag"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="tags-modal-add-submit"
                disabled={busy || !draft.trim()}
                aria-label="Add tag"
              >
                <Plus size={14} aria-hidden />
              </button>
            </form>
          ) : null}
          {onAddLink ? (
            <button
              type="button"
              className="tags-modal-add-link"
              onClick={() => {
                handleClose();
                onAddLink();
              }}
            >
              <Link2 size={14} aria-hidden className="search-field__icon" />
              <span>Add link…</span>
            </button>
          ) : null}
        </div>
      )}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={menu.target ? buildEntityRefMenuGroups(menu.target, {
          onOpen: (r) => {
            handleClose();
            goTo(router, r.href ?? defaultHrefForRef(r));
          },
          onCopy: (value, copyLabel) => void copyTextAndToast(value, copyLabel, toast),
          onUpdateJiraState: (key) => setJiraStateKey(key),
        }) : []}
        onClose={menu.close}
        label={menu.target ? `${menu.target.label || menu.target.id} actions` : "Tag actions"}
      />
      <JiraTransitionModal
        open={jiraStateKey !== null}
        jiraKey={jiraStateKey ?? ""}
        title="Update Jira status"
        skipLabel="Cancel"
        onCancel={() => setJiraStateKey(null)}
        onConfirm={async (transitionId) => {
          const key = jiraStateKey;
          setJiraStateKey(null);
          if (!transitionId || !key) return;
          try {
            const res = await fetch(`/api/jira/ticket/${key}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transitionId }),
            });
            if (!res.ok) throw new Error("Transition failed");
            toast.success(`Updated ${key}`);
          } catch {
            toast.error(`Couldn't transition ${key}`);
          }
        }}
      />
    </ModalShell>
  );
}
