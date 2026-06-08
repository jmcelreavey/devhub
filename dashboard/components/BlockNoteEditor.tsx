"use client";

import { useRef, useCallback, useMemo, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, Search, X, PenTool, Code2, ListTodo } from "lucide-react";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { TextSelection } from "prosemirror-state";
import { AIMenuController, AIToolbarButton } from "@blocknote/xl-ai";
import "@blocknote/xl-ai/style.css";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";
import { devhubBlockNoteSchema } from "@/lib/blocknote-schema";
import { blocknoteDashboardTheme } from "@/lib/blocknote-dashboard-theme";
import { filterDevHubSlashMenuItems } from "@/lib/blocknote-slash-menu";
import { blocknoteNotesAiEditorOptions } from "@/lib/notes-ai/editor-options";
import { useNotesAiConfigured } from "@/lib/notes-ai/use-notes-ai-configured";
import { ChecklistIcon } from "@/lib/checklists/icons";
import { collectCheckboxBlocks } from "@/lib/note-task-sync";
import { NoteEditorProvider } from "@/lib/note-editor-context";
import {
  getLinkHrefFromEvent,
  handleBlockNoteLinkClick,
} from "@/lib/blocknote-link-navigation";
import type { VaultId } from "@/lib/vault/vault-public";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/core/style.css";
import "@blocknote/mantine/style.css";

type TextInlineContent = {
  type?: string;
  text?: string;
  styles?: Record<string, unknown>;
  href?: string;
  content?: unknown;
};

type SearchableBlock = DevHubPartialBlock & {
  id?: string;
  content?: unknown;
  children?: SearchableBlock[];
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countInText(text: string, query: string, caseSensitive: boolean) {
  if (!query) return 0;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return count;
}

type ProseMirrorView = {
  state: import("prosemirror-state").EditorState;
  dispatch: (tr: import("prosemirror-state").Transaction) => void;
  focus: () => void;
};

/**
 * Find the document positions of every query match, in document order, so the
 * active match can be turned into a real text selection. We rebuild a flat
 * string per textblock (matches never span block boundaries) alongside a map
 * from string index back to the ProseMirror position, which keeps the ordering
 * identical to countInText and survives marks splitting a word into several
 * text nodes.
 */
function collectMatchPositions(
  doc: import("prosemirror-model").Node,
  query: string,
  caseSensitive: boolean,
): { from: number; to: number }[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: { from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let flat = "";
    const posMap: number[] = [];
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      const base = pos + 1 + offset;
      for (let i = 0; i < child.text.length; i += 1) {
        posMap.push(base + i);
        flat += child.text[i];
      }
    });
    const haystack = caseSensitive ? flat : flat.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({ from: posMap[index], to: posMap[index + needle.length - 1] + 1 });
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return false;
  });

  return matches;
}

function selectMatch(
  view: ProseMirrorView | null | undefined,
  query: string,
  caseSensitive: boolean,
  matchIndex: number,
): boolean {
  if (!view) return false;
  const { doc } = view.state;
  const matches = collectMatchPositions(doc, query, caseSensitive);
  const target = matches[matchIndex];
  if (!target) return false;
  const selection = TextSelection.create(doc, target.from, target.to);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const inline = item as TextInlineContent;
      if (typeof inline.text === "string") return inline.text;
      return inlineText(inline.content);
    })
    .join("");
}

function replaceInlineContent(
  content: unknown,
  query: string,
  replacement: string,
  caseSensitive: boolean,
  limit = Number.POSITIVE_INFINITY,
): { content: unknown; replaced: number } {
  if (!query || limit <= 0) return { content, replaced: 0 };
  const flags = caseSensitive ? "g" : "gi";
  const pattern = new RegExp(escapeRegExp(query), flags);

  if (typeof content === "string") {
    let replaced = 0;
    const next = content.replace(pattern, (match) => {
      if (replaced >= limit) return match;
      replaced += 1;
      return replacement;
    });
    return { content: next, replaced };
  }

  if (!Array.isArray(content)) return { content, replaced: 0 };

  let replaced = 0;
  const next = content.map((item) => {
    if (replaced >= limit) return item;
    if (typeof item === "string") {
      const result = replaceInlineContent(item, query, replacement, caseSensitive, limit - replaced);
      replaced += result.replaced;
      return result.content;
    }
    if (!item || typeof item !== "object") return item;
    const inline = item as TextInlineContent;
    if (typeof inline.text === "string") {
      const result = replaceInlineContent(inline.text, query, replacement, caseSensitive, limit - replaced);
      replaced += result.replaced;
      return { ...inline, text: result.content };
    }
    if (inline.content !== undefined) {
      const result = replaceInlineContent(inline.content, query, replacement, caseSensitive, limit - replaced);
      replaced += result.replaced;
      return { ...inline, content: result.content };
    }
    return item;
  });

  return { content: next, replaced };
}

function replaceInlineOccurrence(
  content: unknown,
  query: string,
  replacement: string,
  caseSensitive: boolean,
  targetIndex: number,
): { content: unknown; replaced: boolean; seen: number } {
  if (!query || targetIndex < 0) return { content, replaced: false, seen: 0 };
  const flags = caseSensitive ? "g" : "gi";
  const pattern = new RegExp(escapeRegExp(query), flags);

  if (typeof content === "string") {
    let seen = 0;
    let replaced = false;
    const next = content.replace(pattern, (match) => {
      if (replaced) return match;
      if (seen === targetIndex) {
        replaced = true;
        seen += 1;
        return replacement;
      }
      seen += 1;
      return match;
    });
    return { content: next, replaced, seen };
  }

  if (!Array.isArray(content)) return { content, replaced: false, seen: 0 };

  let seen = 0;
  let replaced = false;
  const next = content.map((item) => {
    if (replaced) return item;
    if (typeof item === "string") {
      const result = replaceInlineOccurrence(item, query, replacement, caseSensitive, targetIndex - seen);
      seen += result.seen;
      replaced = result.replaced;
      return result.content;
    }
    if (!item || typeof item !== "object") return item;
    const inline = item as TextInlineContent;
    if (typeof inline.text === "string") {
      const result = replaceInlineOccurrence(inline.text, query, replacement, caseSensitive, targetIndex - seen);
      seen += result.seen;
      replaced = result.replaced;
      return { ...inline, text: result.content };
    }
    if (inline.content !== undefined) {
      const result = replaceInlineOccurrence(inline.content, query, replacement, caseSensitive, targetIndex - seen);
      seen += result.seen;
      replaced = result.replaced;
      return { ...inline, content: result.content };
    }
    return item;
  });

  return { content: next, replaced, seen };
}

function flattenSearchableBlocks(blocks: readonly SearchableBlock[]): SearchableBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...flattenSearchableBlocks(Array.isArray(block.children) ? block.children : []),
  ]);
}

export interface LinkedChecklistContext {
  masterListId: string;
  masterName: string;
  masterIcon?: string;
}

interface BlockNoteEditorProps {
  initialContent?: DevHubPartialBlock[];
  onChange?: (blocks: DevHubPartialBlock[]) => void;
  /** Repo-relative note path (no .json), for checklist label sync. */
  notePath?: string;
  /** Vault context for in-app link navigation. */
  vaultId?: VaultId;
  /** Repo-relative slug without extension, for relative link resolution. */
  contentSlug?: string;
  /** Folder master available to this note, exposed via slash menu. */
  linkedChecklistContext?: LinkedChecklistContext;
  editable?: boolean;
  /**
   * In-editor AI (z.ai). Omit to auto-enable only when `Z_AI_API_KEY` is set.
   * Pass `false` to force off.
   */
  enableAi?: boolean;
  /** Server-known AI availability — skips client status fetch when provided. */
  notesAiConfigured?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function BlockNoteEditor(props: BlockNoteEditorProps) {
  const { configured, ready } = useNotesAiConfigured(props.notesAiConfigured);

  if (!ready) {
    return (
      <div
        className={props.className}
        style={{ minHeight: 120, ...props.style }}
        aria-busy="true"
        aria-label="Loading editor"
      />
    );
  }

  return <BlockNoteEditorReady {...props} aiConfigured={configured} />;
}

interface BlockNoteEditorReadyProps extends BlockNoteEditorProps {
  aiConfigured: boolean;
}

function BlockNoteEditorReady({
  initialContent,
  onChange,
  notePath,
  vaultId = "notes",
  contentSlug = notePath,
  linkedChecklistContext,
  editable = true,
  enableAi,
  aiConfigured,
  className,
  style,
}: BlockNoteEditorReadyProps) {
  const router = useRouter();
  const pathname = usePathname();
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [utilityMode, setUtilityMode] = useState<"find" | "replace">("find");
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [utilityStatus, setUtilityStatus] = useState<string | null>(null);
  const [, forceDocumentRefresh] = useState(0);
  const notesAiEnabled =
    editable && enableAi !== false && aiConfigured && (enableAi === true || enableAi === undefined);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "r") return;
      event.preventDefault();
      setUtilityOpen(true);
      setUtilityMode(key === "r" ? "replace" : "find");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!utilityOpen) return;
    const input = utilityMode === "replace" ? replaceInputRef.current : findInputRef.current;
    input?.focus();
    input?.select();
  }, [utilityMode, utilityOpen]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only init once
  const stableInitialContent = useMemo(() => initialContent, []);

  const linkContextRef = useRef({ vaultId, contentSlug, pathname });
  useEffect(() => {
    linkContextRef.current = { vaultId, contentSlug, pathname };
  }, [vaultId, contentSlug, pathname]);

  const linkClickHandlerRef = useRef<(event: MouseEvent) => void>(() => {});
  useEffect(() => {
    linkClickHandlerRef.current = (event: MouseEvent) => {
      const href = getLinkHrefFromEvent(event);
      if (!href) return;
      const { vaultId: activeVaultId, contentSlug: activeSlug, pathname: activePathname } =
        linkContextRef.current;
      handleBlockNoteLinkClick(
        event,
        href,
        {
          vaultId: activeVaultId,
          contentSlug: activeSlug,
          currentPathname: activePathname,
        },
        {
          push: router.push,
          openExternal: (externalHref) =>
            window.open(externalHref, "_blank", "noopener,noreferrer"),
        },
      );
    };
  }, [router]);

  const editor = useCreateBlockNote(
    {
      schema: devhubBlockNoteSchema,
      initialContent: stableInitialContent,
      animations: true,
      defaultStyles: true,
      links: {
        HTMLAttributes: { rel: "noopener noreferrer" },
        onClick: (event) => linkClickHandlerRef.current(event),
      },
      ...(notesAiEnabled ? blocknoteNotesAiEditorOptions() : {}),
    },
    [notesAiEnabled],
  );

  const wrappedOnChange = useCallback(() => {
    forceDocumentRefresh((version) => version + 1);
    onChangeRef.current?.(editor.document as DevHubPartialBlock[]);
  }, [editor]);

  const searchableBlocks = flattenSearchableBlocks(editor.document as readonly SearchableBlock[]);

  const matchCount = findQuery
    ? searchableBlocks.reduce(
        (total, block) => total + countInText(inlineText(block.content), findQuery, caseSensitive),
        0,
      )
    : 0;

  const clampedActiveMatchIndex = Math.min(activeMatchIndex, Math.max(0, matchCount - 1));

  // Tracks whether the current query has been highlighted yet, so the first
  // navigation lands on the first match instead of skipping straight to the second.
  const hasHighlightedRef = useRef(false);

  const moveToMatch = useCallback(
    (direction: "next" | "previous") => {
      if (!findQuery || matchCount === 0) return;
      const nextIndex = !hasHighlightedRef.current
        ? clampedActiveMatchIndex
        : direction === "next"
          ? (clampedActiveMatchIndex + 1) % matchCount
          : (clampedActiveMatchIndex - 1 + matchCount) % matchCount;
      hasHighlightedRef.current = true;
      setActiveMatchIndex(nextIndex);
      selectMatch(editor.prosemirrorView, findQuery, caseSensitive, nextIndex);
    },
    [caseSensitive, clampedActiveMatchIndex, editor, findQuery, matchCount],
  );

  const replaceCurrent = useCallback(() => {
    if (!findQuery || matchCount === 0) return;
    let seen = 0;
    const target = searchableBlocks.find((block) => {
      const blockMatches = countInText(inlineText(block.content), findQuery, caseSensitive);
      const contains = clampedActiveMatchIndex >= seen && clampedActiveMatchIndex < seen + blockMatches;
      if (!contains) seen += blockMatches;
      return contains;
    });
    if (!target?.id) return;
    const result = replaceInlineOccurrence(
      target.content,
      findQuery,
      replaceValue,
      caseSensitive,
      clampedActiveMatchIndex - seen,
    );
    if (!result.replaced) return;
    editor.updateBlock(target.id, { content: result.content } as DevHubPartialBlock);
    setUtilityStatus("Replaced 1 match.");
    // The replaced occurrence is gone, so the same index now points at the next
    // match — re-highlight it against the freshly updated document.
    selectMatch(editor.prosemirrorView, findQuery, caseSensitive, clampedActiveMatchIndex);
    forceDocumentRefresh((version) => version + 1);
  }, [caseSensitive, clampedActiveMatchIndex, editor, findQuery, matchCount, replaceValue, searchableBlocks]);

  const replaceAll = useCallback(() => {
    if (!findQuery || matchCount === 0) return;
    let replaced = 0;
    searchableBlocks.forEach((block) => {
      if (!block.id) return;
      const result = replaceInlineContent(block.content, findQuery, replaceValue, caseSensitive);
      if (result.replaced === 0) return;
      replaced += result.replaced;
      editor.updateBlock(block.id, { content: result.content } as DevHubPartialBlock);
    });
    setActiveMatchIndex(0);
    setUtilityStatus(`Replaced ${replaced} ${replaced === 1 ? "match" : "matches"}.`);
    forceDocumentRefresh((version) => version + 1);
  }, [caseSensitive, editor, findQuery, matchCount, replaceValue, searchableBlocks]);

  const copyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(
      editor.blocksToMarkdownLossy(editor.document as DevHubPartialBlock[]),
    );
    setUtilityStatus("Copied Markdown.");
  }, [editor]);

  const copyPlainText = useCallback(async () => {
    await navigator.clipboard.writeText(
      searchableBlocks.map((block) => inlineText(block.content)).filter(Boolean).join("\n"),
    );
    setUtilityStatus("Copied plain text.");
  }, [searchableBlocks]);

  const prependSlashItems = useMemo((): DefaultReactSuggestionItem[] => {
    const items: DefaultReactSuggestionItem[] = [];

    if (linkedChecklistContext) {
      const { masterListId, masterName, masterIcon } = linkedChecklistContext;
      items.push({
        title: masterName,
        subtext: "Insert linked checklist",
        aliases: ["checklist", "shared", "linked", "tasks", "todo", masterName.toLowerCase()],
        group: "Other",
        icon: <ChecklistIcon name={masterIcon} size={18} />,
        onItemClick: () => {
          const block = editor.getTextCursorPosition().block;
          editor.insertBlocks(
            [{ type: "sharedChecklist", props: { masterListId, entriesJson: "[]" } }] as DevHubPartialBlock[],
            block,
            "after",
          );
        },
      });
    }

    items.push(
      {
        title: "Embed diagram",
        subtext: "Reference a tldraw diagram",
        aliases: ["diagram", "tldraw", "draw", "canvas", "embed"],
        group: "Other",
        icon: <PenTool size={18} />,
        onItemClick: () => {
          const block = editor.getTextCursorPosition().block;
          editor.insertBlocks(
            [{ type: "diagramEmbed", props: { path: "" } }] as DevHubPartialBlock[],
            block,
            "after",
          );
        },
      },
      {
        title: "Mermaid diagram",
        subtext: "Text-based flowchart / sequence diagram",
        aliases: ["mermaid", "flowchart", "sequence", "graph", "diagram"],
        group: "Other",
        icon: <Code2 size={18} />,
        onItemClick: () => {
          const block = editor.getTextCursorPosition().block;
          editor.insertBlocks(
            [{ type: "mermaid", props: { code: "" } }] as DevHubPartialBlock[],
            block,
            "after",
          );
        },
      },
      {
        title: "Send checkboxes to today's tasks",
        subtext: "Turn this note's checkboxes into linked tasks",
        aliases: ["task", "tasks", "checkbox", "push", "send", "todo"],
        group: "Other",
        icon: <ListTodo size={18} />,
        onItemClick: async () => {
          const today = new Date().toISOString().slice(0, 10);
          const targets = collectCheckboxBlocks(editor.document);
          for (const cb of targets) {
            try {
              const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: cb.text }),
              });
              if (!res.ok) continue;
              const task = (await res.json()) as { id: string };
              if (cb.checked) {
                await fetch("/api/tasks", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: task.id, date: today, done: true }),
                });
              }
              const block = editor.document.find((b) => b.id === cb.id);
              if (block) {
                editor.replaceBlocks(
                  [block],
                  [{ type: "taskRef", props: { taskId: task.id, date: today, label: cb.text } }] as DevHubPartialBlock[],
                );
              }
            } catch (e) {
              console.error("push checkbox to tasks:", e);
            }
          }
        },
      },
    );

    return items;
  }, [editor, linkedChecklistContext]);

  const getSlashItems = useCallback(
    async (query: string) =>
      filterDevHubSlashMenuItems(editor, query, {
        includeAi: notesAiEnabled,
        prepend: prependSlashItems,
      }),
    [editor, notesAiEnabled, prependSlashItems],
  );

  return (
    <NoteEditorProvider notePath={notePath}>
    <div className={className} style={style}>
      {utilityOpen ? (
        <div
          className="fixed left-1/2 top-16 z-50 w-[min(760px,calc(100vw-24px))] -translate-x-1/2 rounded-lg border p-3 text-xs shadow-2xl"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-surface)",
            boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
            color: "var(--text-muted)",
          }}
          role="dialog"
          aria-label="Find and replace"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setUtilityOpen(false);
            }
          }}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-medium" style={{ color: "var(--text)" }}>
              <Search size={14} aria-hidden />
              {utilityMode === "replace" ? "Find and replace" : "Find"}
              <span className="font-normal" style={{ color: "var(--text-subtle)" }}>
                {findQuery ? `${matchCount ? clampedActiveMatchIndex + 1 : 0}/${matchCount}` : "0 matches"}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost h-7 px-2 text-xs"
              onClick={() => setUtilityOpen(false)}
              aria-label="Close find and replace"
            >
              <X size={13} aria-hidden />
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_auto]">
            <input
              ref={findInputRef}
              className="input h-8 text-xs"
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setActiveMatchIndex(0);
                hasHighlightedRef.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  moveToMatch(event.shiftKey ? "previous" : "next");
                }
              }}
              placeholder="Find in this page"
              aria-label="Find text"
            />
            <div className="flex flex-wrap items-center gap-1 md:flex-nowrap md:justify-end">
              <button
                type="button"
                className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
                onClick={() => moveToMatch("previous")}
                disabled={!findQuery || matchCount === 0}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
                onClick={() => moveToMatch("next")}
                disabled={!findQuery || matchCount === 0}
              >
                Next
              </button>
              <label className="flex h-8 shrink-0 items-center gap-1 rounded border px-2" style={{ borderColor: "var(--border)" }} title="Case sensitive">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) => {
                    setCaseSensitive(event.target.checked);
                    setActiveMatchIndex(0);
                    hasHighlightedRef.current = false;
                  }}
                />
                Aa
              </label>
            </div>
          </div>

          {utilityMode === "replace" ? (
            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(220px,1fr)_auto]">
              <input
                ref={replaceInputRef}
                className="input h-8 text-xs"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                placeholder="Replace with"
                aria-label="Replace with"
                disabled={!editable}
              />
              <div className="flex flex-wrap items-center gap-1 md:flex-nowrap md:justify-end">
                <button
                  type="button"
                  className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
                  onClick={replaceCurrent}
                  disabled={!editable || !findQuery || matchCount === 0}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
                  onClick={replaceAll}
                  disabled={!editable || !findQuery || matchCount === 0}
                >
                  Replace all
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2" style={{ borderColor: "var(--border-muted)" }}>
            <button
              type="button"
              className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
              onClick={() => setUtilityMode(utilityMode === "replace" ? "find" : "replace")}
            >
              {utilityMode === "replace" ? "Hide replace" : "Show replace"}
            </button>
            <button
              type="button"
              className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
              onClick={copyMarkdown}
              title="Copy as Markdown"
            >
              <Copy size={13} aria-hidden />
              Markdown
            </button>
            <button
              type="button"
              className="btn btn-ghost h-8 shrink-0 px-2 text-xs"
              onClick={copyPlainText}
              title="Copy plain text"
            >
              <Copy size={13} aria-hidden />
              Text
            </button>
            {utilityStatus ? (
              <span className="ml-auto" style={{ color: "var(--text-subtle)" }} aria-live="polite">
                {utilityStatus}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={wrappedOnChange}
        theme={blocknoteDashboardTheme}
        slashMenu={false}
        formattingToolbar={notesAiEnabled ? false : undefined}
      >
        {notesAiEnabled ? <AIMenuController /> : null}
        {notesAiEnabled ? (
          <FormattingToolbarController
            formattingToolbar={() => (
              <FormattingToolbar>
                {getFormattingToolbarItems()}
                <AIToolbarButton />
              </FormattingToolbar>
            )}
          />
        ) : null}
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
      </BlockNoteView>
    </div>
    </NoteEditorProvider>
  );
}
