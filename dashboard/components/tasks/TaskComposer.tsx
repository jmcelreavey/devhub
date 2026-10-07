"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { FilePen, FolderGit2, Link as LinkIcon, Plus, X } from "lucide-react";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";
import { KIND_ICON } from "@/components/EntityLinkChips";
import {
  MENTION_TAIL,
  useMentionSuggestions,
  type MentionSuggestion,
} from "@/components/tasks/useMentionSuggestions";
import { HoverTip } from "@/components/ui/HoverTip";
import { defaultHrefForRef, entityKey, mergeEntityRefs, type EntityRef } from "@/lib/entity-note";
import { useToast } from "@/lib/hooks/use-toast";
import { detectBareUrl } from "@/lib/tasks/task-text";
import type { Task } from "@/lib/tasks/types";

const NO_LINKS: readonly EntityRef[] = [];

export interface TaskComposerProps {
  inputId?: string;
  placeholder?: string;
  /**
   * Links every task from this composer carries without the user adding them —
   * the repo hub pins its own repo. Not shown as removable chips.
   */
  baseLinks?: readonly EntityRef[];
  /** The created task, after the POST succeeds. */
  onAdded: (task: Task) => void | Promise<void>;
}

/**
 * The Today task composer: `@mention` autocomplete, bare-URL naming,
 * link chips, repo association, and ⇧↵ draft capture.
 *
 * Lifted out of `TaskList` so the repo hub adds tasks with the same tool —
 * a plain input there was why planning kept happening on Today instead.
 */
export function TaskComposer({
  inputId = "task-add-text",
  placeholder = "Add a task… (paste a link or Jira key, @ to link)",
  baseLinks = NO_LINKS,
  onAdded,
}: TaskComposerProps) {
  const [newText, setNewText] = useState("");
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [pendingLinks, setPendingLinks] = useState<EntityRef[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  /** Open while the text ends in `@fragment` — search anything linkable; a pick becomes a chip. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const mentionItems = useMentionSuggestions(mentionQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkNameRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleInputChange = useCallback((value: string) => {
    setNewText(value);
    const url = detectBareUrl(value);
    if (url) {
      setDetectedUrl(url);
    } else {
      setDetectedUrl(null);
      setLinkName("");
    }
  }, []);

  const handleTextChange = useCallback((value: string) => {
    handleInputChange(value);
    setMentionQuery(MENTION_TAIL.exec(value)?.[2] ?? null);
    setMentionActive(0);
  }, [handleInputChange]);

  /** Drop the trailing `@fragment` and link the picked entity instead. */
  const applyMention = useCallback((pick: MentionSuggestion) => {
    setNewText((prev) => prev.replace(MENTION_TAIL, "$1"));
    setPendingLinks((prev) => mergeEntityRefs(prev, [pick.ref]));
    setMentionQuery(null);
    inputRef.current?.focus();
  }, []);

  const confirmLink = useCallback(() => {
    if (!detectedUrl || !linkName.trim()) return;
    const mdLink = `[${linkName.trim()}](${detectedUrl})`;
    setNewText((prev) => prev.replace(detectedUrl, mdLink));
    setDetectedUrl(null);
    setLinkName("");
    inputRef.current?.focus();
  }, [detectedUrl, linkName]);

  const dismissLinkPrompt = useCallback(() => {
    setDetectedUrl(null);
    setLinkName("");
    inputRef.current?.focus();
  }, []);

  /** `asDraft` captures an idea: a draft task plus a context snapshot in its note. */
  const addTask = useCallback(async (asDraft = false) => {
    const text = newText.trim();
    if (!text) return;
    const links = mergeEntityRefs([...baseLinks], pendingLinks);
    try {
      const res = await fetch(asDraft ? "/api/tasks/capture" : "/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(links.length > 0 ? { links } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as Task | { task: Task };
      const task = "task" in body ? body.task : body;
      if (asDraft) toast.success("Captured as a draft — related context is in its note");
      setNewText("");
      setPendingLinks([]);
      setDetectedUrl(null);
      setLinkName("");
      setMentionQuery(null);
      await onAdded(task);
      inputRef.current?.focus();
    } catch (e) {
      console.error("add task:", e);
      toast.error("Couldn't add task.");
    }
  }, [newText, baseLinks, pendingLinks, toast, onAdded]);

  const repoLinked = [...baseLinks, ...pendingLinks].some((ref) => ref.kind === "repo");

  return (
    <>
      <div className="task-add-row">
        <label htmlFor={inputId} className="sr-only">
          Add a task
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="input task-add-text"
          placeholder={placeholder}
          value={newText}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={() => {
            setMentionQuery(null);
          }}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionItems.length > 0) {
              const active = Math.min(mentionActive, mentionItems.length - 1);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setMentionActive((active + step + mentionItems.length) % mentionItems.length);
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                applyMention(mentionItems[active]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
            }
            if (e.key !== "Enter") return;
            const currentText = (e.target as HTMLInputElement).value;
            const freshUrl = detectedUrl || detectBareUrl(currentText);
            if (freshUrl && linkName.trim()) {
              e.preventDefault();
              confirmLink();
            } else if (freshUrl) {
              e.preventDefault();
              setDetectedUrl(freshUrl);
              setNewText(currentText);
            } else {
              // Shift+Enter captures a draft instead of a ready task.
              void addTask(e.shiftKey);
            }
          }}
        />
        {mentionQuery !== null && mentionItems.length > 0 && (
          <ul className="task-tag-sugs" role="listbox" aria-label="Link suggestions">
            {mentionItems.map((item, i) => {
              const Icon = KIND_ICON[item.kind];
              const active = i === Math.min(mentionActive, mentionItems.length - 1);
              return (
                <li key={entityKey(item.ref)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    // mousedown, not click — blur would close the list first
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(item);
                    }}
                    onMouseEnter={() => setMentionActive(i)}
                  >
                    <Icon size={11} className="mr-1.5 inline-block align-[-1px]" aria-hidden />
                    {item.title}
                    <span className="ml-2 text-text-muted">{item.meta}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {pendingLinks.length > 0 ? (
          <ul className="entity-link-chips" aria-label="Links for this task">
            {pendingLinks.map((ref) => {
              const text = ref.label || ref.id;
              const href = defaultHrefForRef(ref);
              const Icon = KIND_ICON[ref.kind] ?? FolderGit2;
              return (
                <li key={entityKey(ref)} className="entity-link-chip-item" data-entity-chip="">
                  {href ? (
                    <Link href={href} className="entity-link-chip" data-kind={ref.kind} title={text}>
                      <Icon size={10} aria-hidden />
                      <span>{text}</span>
                    </Link>
                  ) : (
                    <span className="entity-link-chip" data-kind={ref.kind} title={text}>
                      <Icon size={10} aria-hidden />
                      <span>{text}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="entity-link-chip-remove"
                    aria-label={`Remove ${text} link`}
                    onClick={() =>
                      setPendingLinks((prev) => prev.filter((r) => entityKey(r) !== entityKey(ref)))
                    }
                  >
                    <X size={10} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <HoverTip label="Associate repo" pos="top-end">
          <button
            type="button"
            className="task-icon-action"
            aria-label="Associate repo"
            aria-haspopup="dialog"
            aria-expanded={linkOpen}
            data-linked={repoLinked || undefined}
            onClick={() => setLinkOpen(true)}
          >
            <FolderGit2 size={14} aria-hidden />
          </button>
        </HoverTip>
        <HoverTip label="Capture as draft (⇧↵) — saves related notes, PRs and alerts" pos="top-end">
          <button
            type="button"
            className="task-icon-action"
            onClick={() => void addTask(true)}
            disabled={!newText.trim()}
            aria-label="Capture as draft"
          >
            <FilePen size={14} aria-hidden />
          </button>
        </HoverTip>
        <HoverTip label="Add task" pos="top-end">
          <button
            type="button"
            className="btn btn-ghost task-add-btn"
            onClick={() => void addTask()}
            disabled={!newText.trim()}
            aria-label="Add task"
          >
            <Plus size={14} aria-hidden />
          </button>
        </HoverTip>
      </div>

      <EntityLinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        defaultKind="repo"
        existing={pendingLinks}
        title="Link repo"
        description="Link a local repository. The task shows up on that repo's hub."
        onSave={async (refs) => {
          setPendingLinks((prev) => mergeEntityRefs(prev, refs));
        }}
      />

      {detectedUrl && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-elevated"
        >
          <LinkIcon size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
          <span className="text-xs shrink-0 text-text-subtle">
            Link name:
          </span>
          <input
            ref={linkNameRef}
            className="input task-link-name-input"
            placeholder="e.g. Notes"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (linkName.trim()) confirmLink();
              } else if (e.key === "Escape") {
                dismissLinkPrompt();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px", fontSize: 12 }}
            onClick={linkName.trim() ? confirmLink : dismissLinkPrompt}
          >
            {linkName.trim() ? "Add" : "Skip"}
          </button>
        </div>
      )}
    </>
  );
}
