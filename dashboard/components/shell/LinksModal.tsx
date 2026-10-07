"use client";

import { useId, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronRight, Link2, Plus, X } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { KIND_ICON } from "@/components/EntityLinkChips";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { defaultHrefForRef, type EntityKind, type EntityRef } from "@/lib/entity-note";
import { stripTagTokens } from "@/lib/tasks/task-text";

const LINK_KIND_HEADING: Partial<Record<EntityKind, string>> = {
  task: "Tasks",
  note: "Notes",
  pr: "Pull requests",
  jira: "Jira tickets",
  calendar: "Calendar events",
  meeting: "Meetings",
  diagram: "Diagrams",
  repo: "Repositories",
};

/** Repos lead because they are the hop people take most. */
const KIND_ORDER: EntityKind[] = ["repo", "pr", "jira", "note", "diagram", "task", "calendar", "meeting"];

function kindRank(kind: EntityKind): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

/** Linked items sorted by kind (stable within a kind). Hashtags are not links. */
export function groupLinkRefs(refs: readonly EntityRef[]): EntityRef[] {
  return refs
    .map((ref, i) => ({ ref, i }))
    .filter(({ ref }) => ref.kind !== "tag")
    .sort((a, b) => kindRank(a.ref.kind) - kindRank(b.ref.kind) || a.i - b.i)
    .map(({ ref }) => ref);
}

function goTo(router: ReturnType<typeof useRouter>, dest: string | null | undefined) {
  if (!dest) return;
  if (/^https?:\/\//i.test(dest)) {
    window.open(dest, "_blank", "noopener,noreferrer");
  } else {
    router.push(dest);
  }
}

function refLabel(ref: EntityRef): string {
  // A linked task's label is its full text; leftover #tokens are noise here.
  if (ref.kind === "task" && ref.label) return stripTagTokens(ref.label).trim() || ref.label;
  return ref.label || ref.id;
}

/**
 * Everything a row is linked to — repos, PRs, notes, tasks. Header shows which
 * entity you're looking at
 * (type icon + name). Add/remove live here so rows don't need a chip strip
 * and the context menu doesn't grow a second "link" entry.
 */
export function LinksModal({
  open,
  onClose,
  kind,
  title,
  subtitle,
  refs,
  onRemoveRef,
  onAddLink,
  onTagContextMenu,
}: {
  open: boolean;
  onClose: () => void;
  kind?: EntityKind;
  /** Header — usually the row title. */
  title?: string;
  subtitle?: string;
  refs: EntityRef[];
  onRemoveRef?: (ref: EntityRef) => void | Promise<void>;
  onAddLink?: () => void;
  onTagContextMenu?: (e: MouseEvent, ref: EntityRef) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<EntityRef>();
  const [jiraStateKey, setJiraStateKey] = useState<string | null>(null);
  const HeaderIcon = kind ? (KIND_ICON[kind] ?? Link2) : Link2;
  const heading = title?.trim() || "Links";
  const links = groupLinkRefs(refs);
  const sectionId = useId();
  const groups = KIND_ORDER.map((linkKind) => ({
    kind: linkKind,
    refs: links.filter((ref) => ref.kind === linkKind),
  })).filter((group) => group.refs.length > 0);

  const renderRef = (ref: EntityRef) => {
    const Icon = KIND_ICON[ref.kind] ?? Link2;
    const dest = ref.href ?? defaultHrefForRef(ref);
    const label = refLabel(ref);
    const external = !!dest && /^https?:\/\//i.test(dest);
    return (
      <li key={`${ref.kind}:${ref.id}`}>
        <div className="links-modal-row">
          <button
            type="button"
            className="links-modal-item"
            title={label}
            disabled={!dest}
            onClick={() => {
              onClose();
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
            <Icon size={16} aria-hidden className="links-modal-item-icon" data-kind={ref.kind} />
            <span className="links-modal-item-copy">
              <span className="links-modal-item-label">{label}</span>
            </span>
            {dest ? (
              external
                ? <ArrowUpRight size={14} aria-hidden className="links-modal-item-arrow" />
                : <ChevronRight size={14} aria-hidden className="links-modal-item-arrow" />
            ) : null}
          </button>
          {onRemoveRef ? (
            <button
              type="button"
              className="links-modal-remove"
              aria-label={`Remove ${label}`}
              onClick={() => {
                void onRemoveRef(ref);
              }}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={<HeaderIcon size={16} />}
      title={heading}
      wrapTitle
      description={subtitle}
      maxWidth="max-w-3xl"
      footer={
        <div className="links-modal-footer">
          <span className="links-modal-count">
            {links.length} linked {links.length === 1 ? "item" : "items"}
          </span>
          {onAddLink ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onClose();
                onAddLink();
              }}
            >
              <Plus size={14} aria-hidden />
              Add link…
            </button>
          ) : null}
        </div>
      }
    >
      {links.length === 0 ? (
        <div className="links-modal-empty">
          <Link2 size={24} aria-hidden />
          <p>Nothing linked yet.</p>
          {onAddLink ? <p>Link a repository, pull request, note, or task to keep related work together.</p> : null}
        </div>
      ) : (
        <div className="links-modal-groups">
          {groups.map((group) => (
            <section
              key={group.kind}
              className="links-modal-section"
              aria-labelledby={`${sectionId}-${group.kind}`}
            >
              <h3 id={`${sectionId}-${group.kind}`} className="links-modal-section-title">
                {LINK_KIND_HEADING[group.kind]}
                <span className="links-modal-section-count">{group.refs.length}</span>
              </h3>
              <ul className="links-modal-list" aria-label={LINK_KIND_HEADING[group.kind]}>
                {group.refs.map(renderRef)}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={menu.target ? buildEntityRefMenuGroups(menu.target, {
          onOpen: (r) => {
            onClose();
            goTo(router, r.href ?? defaultHrefForRef(r));
          },
          onCopy: (value, copyLabel) => void copyTextAndToast(value, copyLabel, toast),
          onUpdateJiraState: (key) => setJiraStateKey(key),
        }) : []}
        onClose={menu.close}
        label={menu.target ? `${menu.target.label || menu.target.id} actions` : "Link actions"}
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
