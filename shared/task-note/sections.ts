/**
 * Task-note structure: well-known sections, the pure operations agents use to
 * keep them tidy, a reader for the visual note view, and the lazy migration of
 * the older bullet-line header.
 *
 * Everything works on BlockNote JSON (the stored form) and never round-trips the
 * whole note through markdown, so the user's free-form blocks — nesting, colours,
 * block ids — are passed through untouched. Only the blocks of the section an
 * operation names are rewritten.
 *
 * Section layout (all `##` headings, matched case-insensitively):
 *   Summary · Status · Questions for John · Decisions · Screenshots and video ·
 *   Bugs · Points of interest · Waypoints · … free-form … · Log
 * Item conventions live in plain markdown shapes (bullets, checkboxes, images,
 * a bold lead-in) so the note stays editable and diffable in the normal editor.
 */

import { readStatusUpdate, STATUS_UPDATE_LABELS, type TaskStatusUpdate } from "./status-update.ts";
import { isRank } from "./rank.ts";
import { blocksToText, parseInlineMarkdown } from "../markdown-convert/index.ts";
import {
  isExternalMediaUrl,
  isVideoMediaPath,
  toNoteAssetApiUrl,
} from "../notes-assets/markdown.ts";
import { entityRefToTaskNoteLink, parseEntityLinksFromMarkdown, type EntityRef } from "../entity-note/index.ts";
import {
  TASK_META_LANG,
  isTaskNoteStatus,
  mergeTaskNoteLinks,
  normalizeTaskNoteLink,
  normalizeTaskNoteMeta,
  parseTaskNoteMetaText,
  safeLinkHref,
  serializeTaskNoteMeta,
  type TaskNoteLink,
  type TaskNoteMeta,
} from "./meta.ts";

/* ───────────────────────── types ───────────────────────── */

export interface NoteBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown[];
}

export interface InlineNode {
  type: string;
  text?: string;
  href?: string;
  styles?: Record<string, unknown>;
  content?: InlineNode[];
}

export const TASK_NOTE_SECTION_KEYS = [
  "summary",
  "status",
  "questions",
  "decisions",
  "userNotes",
  "media",
  "bugs",
  "poi",
  "waypoints",
  "log",
] as const;
export type TaskNoteSectionKey = (typeof TASK_NOTE_SECTION_KEYS)[number];

export const TASK_NOTE_SECTION_HEADING: Record<TaskNoteSectionKey, string> = {
  summary: "Summary",
  status: "Status",
  questions: "Questions for John",
  decisions: "Decisions",
  userNotes: "Your notes",
  media: "Screenshots and video",
  bugs: "Bugs",
  poi: "Points of interest",
  waypoints: "Waypoints",
  log: "Log",
};

const SECTION_ALIASES: Record<string, TaskNoteSectionKey> = {
  summary: "summary",
  status: "status",
  "questions for john": "questions",
  decisions: "decisions",
  "your notes": "userNotes",
  "screenshots and video": "media",
  "screenshots & video": "media",
  screenshots: "media",
  bugs: "bugs",
  "points of interest": "poi",
  waypoints: "waypoints",
  log: "log",
};

export const BUG_STATUSES = ["open", "fixed", "wontfix"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const BUG_SEVERITIES = ["blocker", "high", "medium", "low"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export type MediaPhase = "before" | "after";

export function isTaskNotePath(notePath: string): boolean {
  return /^task-notes\/[^/]+$/.test(notePath.replace(/\.json$/, ""));
}

export class TaskNoteOpError extends Error {}

/* ───────────────────────── block helpers ───────────────────────── */

const BASE_PROPS = { textColor: "default", backgroundColor: "default", textAlignment: "left" };

function makeBlock(type: string, content: InlineNode[] | undefined, props: Record<string, unknown> = {}): NoteBlock {
  return {
    id: crypto.randomUUID(),
    type,
    props: { ...BASE_PROPS, ...props },
    ...(content ? { content } : {}),
    children: [],
  };
}

function inlineText(text: string, styles: Record<string, unknown> = {}): InlineNode {
  return { type: "text", text, styles };
}

export function inlinePlainText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as InlineNode[])
    .map((node) => (node.type === "link" ? inlinePlainText(node.content) : (node.text ?? "")))
    .join("");
}

export function blockPlainText(block: NoteBlock): string {
  return inlinePlainText(block.content);
}

/** Collapse whitespace so a value can never open a new markdown block. */
function oneLine(value: string, max = 600): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Titles go into bold runs; stray emphasis markers would break the markdown round trip. */
function plainTitle(value: string, max = 160): string {
  return oneLine(value, max).replace(/[*`]/g, "");
}

function inlineFromMarkdown(value: string): InlineNode[] {
  return parseInlineMarkdown(oneLine(value)) as InlineNode[];
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isHeading(block: NoteBlock, maxLevel = 2): boolean {
  return block.type === "heading" && Number(block.props?.level ?? 1) <= maxLevel;
}

function sectionKeyOf(block: NoteBlock): TaskNoteSectionKey | undefined {
  if (block.type !== "heading" || Number(block.props?.level) !== 2) return undefined;
  return SECTION_ALIASES[blockPlainText(block).trim().toLowerCase()];
}

function isMetaBlock(block: NoteBlock): boolean {
  return block.type === "codeBlock" && block.props?.language === TASK_META_LANG;
}

function signature(block: NoteBlock): string {
  return JSON.stringify([block.type, block.props?.checked ?? null, blocksToText([block])]);
}

/* ───────────────────────── split / join ───────────────────────── */

export interface SplitTaskNote {
  title?: NoteBlock;
  metaBlock?: NoteBlock;
  /** `null` when the fence exists but is not valid JSON: left alone, never overwritten. */
  meta: TaskNoteMeta | null;
  /** `::task-ref` blocks that sit with the title (they are the task backlink, not content). */
  refs: NoteBlock[];
  headings: Partial<Record<TaskNoteSectionKey, NoteBlock>>;
  sections: Partial<Record<TaskNoteSectionKey, NoteBlock[]>>;
  /** Everything the user (or older writers) put in that is not a well-known section. */
  freeform: NoteBlock[];
}

/** Partition top-level blocks into title, metadata, standard sections and free-form content. */
export function splitTaskNote(blocks: unknown[]): SplitTaskNote {
  const list = blocks as NoteBlock[];
  const out: SplitTaskNote = { meta: {}, refs: [], headings: {}, sections: {}, freeform: [] };
  let start = 0;
  if (list[0] && list[0].type === "heading" && Number(list[0].props?.level) === 1) {
    out.title = list[0];
    start = 1;
  }

  let current: TaskNoteSectionKey | null = null;
  let sawHeading = false;
  for (const block of list.slice(start)) {
    if (!out.metaBlock && isMetaBlock(block)) {
      out.metaBlock = block;
      out.meta = parseTaskNoteMetaText(blockPlainText(block));
      continue;
    }
    if (block.type === "taskRef" && !sawHeading) {
      out.refs.push(block);
      continue;
    }
    if (isHeading(block)) {
      sawHeading = true;
      const key = sectionKeyOf(block);
      if (key) {
        current = key;
        out.headings[key] ??= block;
        out.sections[key] ??= [];
        continue;
      }
      current = null;
      out.freeform.push(block);
      continue;
    }
    if (current) out.sections[current]!.push(block);
    else out.freeform.push(block);
  }
  return out;
}

/** Inverse of `splitTaskNote`: canonical order, empty sections dropped, Log last. */
export function joinTaskNote(split: SplitTaskNote): NoteBlock[] {
  const out: NoteBlock[] = [];
  if (split.title) out.push(split.title);
  if (split.metaBlock) out.push(split.metaBlock);
  out.push(...split.refs);
  const emit = (key: TaskNoteSectionKey) => {
    const body = split.sections[key];
    if (!body || body.length === 0) return;
    out.push(split.headings[key] ?? makeBlock("heading", [inlineText(TASK_NOTE_SECTION_HEADING[key])], { level: 2 }));
    out.push(...body);
  };
  for (const key of TASK_NOTE_SECTION_KEYS) if (key !== "log") emit(key);
  out.push(...split.freeform);
  emit("log");
  return out;
}

/* ───────────────────────── item parsing ───────────────────────── */

const ITEM_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function isItem(block: NoteBlock): boolean {
  return ITEM_TYPES.has(block.type) || (block.type === "paragraph" && blockPlainText(block).trim() !== "");
}

const ANSWER_SPLIT_RE = /\s*→\s*Answer:\s*/;

export interface QuestionItem {
  id: string;
  text: string;
  /** Suggested answers the agent offered, shown as buttons beside the free-text box. */
  options?: string[];
  answer?: string;
  resolved: boolean;
}
export interface DecisionItem {
  id: string;
  title: string;
  body: InlineNode[];
}
export interface BugItem {
  id: string;
  status: BugStatus;
  severity?: BugSeverity;
  title: string;
  details?: string;
  /** What was done about it, written when the bug is marked fixed or wontfix. */
  resolution?: string;
}
export interface PoiItem {
  id: string;
  file?: string;
  note: InlineNode[];
}
export interface WaypointItem {
  id: string;
  title: string;
  done: boolean;
}
export interface MediaItem {
  id: string;
  kind: "image" | "video";
  url: string;
  caption: string;
  phase?: MediaPhase;
  name: string;
}
export interface LogItem {
  id: string;
  at?: string;
  message: string;
}

export interface UserNoteItem {
  id: string;
  at: string;
  text: string;
}

function parseUserNote(block: NoteBlock): UserNoteItem {
  const text = blockPlainText(block);
  const match = /^\[([^\]]+)\] ([\s\S]*)$/.exec(text);
  return { id: block.id ?? "", at: match?.[1] ?? "", text: match?.[2] ?? text };
}

function inlineOf(block: NoteBlock): InlineNode[] {
  return Array.isArray(block.content) ? (block.content as InlineNode[]) : [];
}

const OPTIONS_RE = /\s+\bOptions:\s*(.+)$/i;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 120;

function normalizeQuestionOptions(options: readonly string[]): string[] {
  return [...new Set(options.map((option) => oneLine(option.replace(/\|/g, " "), MAX_OPTION_LENGTH)).filter(Boolean))].slice(0, MAX_OPTIONS);
}

/** "Which env? Options: dev | prod" → the question and its suggested answers. */
function splitQuestionOptions(text: string): { text: string; options?: string[] } {
  const match = OPTIONS_RE.exec(text);
  if (!match) return { text };
  const options = normalizeQuestionOptions(match[1]!.split("|"));
  return options.length ? { text: text.slice(0, match.index).trim(), options } : { text };
}

function parseQuestion(block: NoteBlock): QuestionItem {
  const [rawText, ...rest] = blockPlainText(block).split(ANSWER_SPLIT_RE);
  const answer = rest.join(" ").trim();
  const { text, options } = splitQuestionOptions((rawText ?? "").trim());
  return {
    id: block.id ?? "",
    text,
    ...(options ? { options } : {}),
    ...(answer ? { answer } : {}),
    resolved: block.props?.checked === true || answer !== "",
  };
}

function parseDecision(block: NoteBlock): DecisionItem {
  const nodes = inlineOf(block);
  const first = nodes[0];
  if (first && first.type === "text" && first.styles?.bold && first.text) {
    return { id: block.id ?? "", title: first.text.trim(), body: nodes.slice(1) };
  }
  return { id: block.id ?? "", title: oneLine(blockPlainText(block), 90), body: [] };
}

const RESOLUTION_SPLIT_RE = /\s*→\s*Resolved:\s*/;

function parseBug(block: NoteBlock): BugItem {
  const nodes = inlineOf(block);
  let status: BugStatus = "open";
  let severity: BugSeverity | undefined;
  let rest = nodes;
  const first = nodes[0];
  if (first && first.type === "text" && first.styles?.bold && first.text) {
    const tokens = first.text.toLowerCase().split(/[·,|/]/).map((t) => t.trim().replace(/[^a-z]/g, ""));
    const foundStatus = tokens.find((t): t is BugStatus => (BUG_STATUSES as readonly string[]).includes(t));
    const foundSeverity = tokens.find((t): t is BugSeverity => (BUG_SEVERITIES as readonly string[]).includes(t));
    if (foundStatus || foundSeverity) {
      status = foundStatus ?? "open";
      severity = foundSeverity;
      rest = nodes.slice(1);
    }
  }
  const [body, ...resolved] = inlinePlainText(rest).trim().split(RESOLUTION_SPLIT_RE);
  const resolution = resolved.join(" ").trim();
  const [title, ...details] = (body ?? "").split(/\s+—\s+/);
  return {
    id: block.id ?? "",
    status,
    ...(severity ? { severity } : {}),
    title: (title ?? "").trim(),
    ...(details.length ? { details: details.join(" — ").trim() } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function parsePoi(block: NoteBlock): PoiItem {
  const nodes = inlineOf(block);
  const first = nodes[0];
  if (first && first.type === "text" && first.styles?.code && first.text) {
    const rest = nodes.slice(1);
    const lead = rest[0];
    if (lead && lead.type === "text" && lead.text) {
      rest[0] = { ...lead, text: lead.text.replace(/^\s*(?::|—|-)\s*/, "") };
    }
    return { id: block.id ?? "", file: first.text, note: rest };
  }
  return { id: block.id ?? "", note: nodes };
}

function parseWaypoint(block: NoteBlock): WaypointItem {
  return { id: block.id ?? "", title: blockPlainText(block).trim(), done: block.props?.checked === true };
}

const PHASE_RE = /^(before|after)\s*[:—-]\s*/i;

function parseMedia(block: NoteBlock): MediaItem | undefined {
  if (block.type !== "image" && block.type !== "video") return undefined;
  const url = typeof block.props?.url === "string" ? block.props.url : "";
  if (!url) return undefined;
  const rawCaption = typeof block.props?.caption === "string" ? block.props.caption : "";
  const phase = rawCaption.match(PHASE_RE)?.[1]?.toLowerCase() as MediaPhase | undefined;
  return {
    id: block.id ?? "",
    kind: block.type === "video" ? "video" : "image",
    url,
    caption: rawCaption.replace(PHASE_RE, "").trim(),
    ...(phase ? { phase } : {}),
    name: typeof block.props?.name === "string" ? block.props.name : (url.split("/").pop() ?? ""),
  };
}

const LOG_AT_RE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s+[—-]\s+/;

function parseLog(block: NoteBlock): LogItem {
  const text = blockPlainText(block).trim();
  const at = text.match(LOG_AT_RE)?.[1];
  return { id: block.id ?? "", ...(at ? { at } : {}), message: text.replace(LOG_AT_RE, "") };
}

/* ───────────────────────── view model ───────────────────────── */

export interface TaskNoteView {
  statusUpdate?: TaskStatusUpdate;
  latestScreenshot?: MediaItem;
  title: string;
  /** `null` when the task-meta fence is not valid JSON; the view shows a repair hint. */
  meta: TaskNoteMeta | null;
  hasMeta: boolean;
  taskRef?: { taskId: string; date: string; label: string };
  summary: InlineNode[][];
  statusText: InlineNode[][];
  questions: QuestionItem[];
  decisions: DecisionItem[];
  userNotes: UserNoteItem[];
  media: MediaItem[];
  bugs: BugItem[];
  poi: PoiItem[];
  waypoints: WaypointItem[];
  log: LogItem[];
  /** Plain text of blocks inside a standard section that do not fit its item shape. */
  other: Partial<Record<TaskNoteSectionKey, string[]>>;
  freeformCount: number;
}

/** Read a note into the shape the visual view renders. Never throws on odd content. */
export function readTaskNote(blocks: unknown[]): TaskNoteView {
  const split = splitTaskNote(blocks);
  const section = (key: TaskNoteSectionKey) => split.sections[key] ?? [];
  const other: TaskNoteView["other"] = {};
  const stray = (key: TaskNoteSectionKey, block: NoteBlock) => {
    const text = blockPlainText(block).trim() || blocksToText([block]).trim();
    if (text) (other[key] ??= []).push(text);
  };

  const paragraphs = (key: TaskNoteSectionKey) =>
    section(key).flatMap((block) => {
      const nodes = inlineOf(block);
      if (nodes.length === 0 || blockPlainText(block).trim() === "") return [];
      return [nodes];
    });

  const collect = <T>(key: TaskNoteSectionKey, parse: (block: NoteBlock) => T | undefined, accept = isItem) => {
    const items: T[] = [];
    for (const block of section(key)) {
      const item = accept(block) ? parse(block) : undefined;
      if (item === undefined) stray(key, block);
      else items.push(item);
    }
    return items;
  };

  const statusUpdate = readStatusUpdate(section("status").map(blockPlainText));
  const latestScreenshot = section("media").map(parseMedia).filter((item) => item?.kind === "image" && safeLinkHref(item.url)).at(-1);
  const ref = split.refs[0]?.props;
  return {
    title: split.title ? blockPlainText(split.title).trim() : "",
    meta: split.meta,
    hasMeta: Boolean(split.metaBlock),
    ...(ref
      ? { taskRef: { taskId: String(ref.taskId ?? ""), date: String(ref.date ?? ""), label: String(ref.label ?? "") } }
      : {}),
    ...(statusUpdate ? { statusUpdate } : {}),
    ...(latestScreenshot ? { latestScreenshot } : {}),
    summary: paragraphs("summary"),
    statusText: paragraphs("status"),
    questions: collect("questions", parseQuestion),
    decisions: collect("decisions", parseDecision),
    userNotes: collect("userNotes", parseUserNote),
    media: collect("media", parseMedia, () => true),
    bugs: collect("bugs", parseBug),
    poi: collect("poi", parsePoi),
    waypoints: collect("waypoints", parseWaypoint),
    log: collect("log", parseLog),
    other,
    freeformCount: split.freeform.length,
  };
}

/* ───────────────────────── operations ───────────────────────── */

export type TaskNoteOp =
  | { op: "set_status_update"; statusUpdate: TaskStatusUpdate }
  | { op: "set_summary"; text: string }
  | { op: "set_status"; status?: string; text?: string }
  | { op: "set_rank"; rank?: string }
  | { op: "add_question"; text: string; options?: string[] }
  | { op: "resolve_question"; id?: string; match?: string; answer?: string; reopen?: boolean }
  | { op: "add_decision"; title: string; why?: string; alternatives?: string[] }
  | { op: "add_media"; url?: string; assetPath?: string; caption?: string; phase?: MediaPhase; kind?: "image" | "video" }
  | { op: "add_bug"; title: string; details?: string; severity?: BugSeverity; status?: BugStatus }
  | { op: "set_bug_status"; id?: string; match?: string; status: BugStatus; severity?: BugSeverity; resolution?: string }
  | { op: "add_waypoint"; title: string; done?: boolean }
  | { op: "add_poi"; file?: string; note: string }
  | { op: "append_log"; message: string; at?: string }
  | { op: "add_user_note"; text: string }
  | {
      op: "set_meta";
      status?: string;
      tags?: string[];
      models?: string[];
      links?: TaskNoteLink[];
      addTags?: string[];
      addModels?: string[];
      addLinks?: TaskNoteLink[];
    }
  | { op: "remove_item"; section: TaskNoteSectionKey; id?: string; match?: string }
  | { op: "clear_section"; section: TaskNoteSectionKey };

export const TASK_NOTE_OP_NAMES = [
  "set_status_update",
  "set_summary",
  "set_status",
  "set_rank",
  "add_question",
  "resolve_question",
  "add_decision",
  "add_media",
  "add_bug",
  "set_bug_status",
  "add_waypoint",
  "add_poi",
  "append_log",
  "add_user_note",
  "set_meta",
  "remove_item",
  "clear_section",
] as const;

export interface TaskNoteOpContext {
  now?: Date;
}

export interface TaskNoteOpResult {
  blocks: NoteBlock[];
  changed: boolean;
  /** One line describing what happened; safe to hand back to an agent. */
  message: string;
}

type Raw = Record<string, unknown>;

function str(raw: Raw, key: string, max = 2000): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TaskNoteOpError(`${key} must be a string`);
  return value.slice(0, max);
}

function reqStr(raw: Raw, key: string, max = 2000): string {
  const value = str(raw, key, max)?.trim();
  if (!value) throw new TaskNoteOpError(`${key} is required`);
  return value;
}

function strList(raw: Raw, key: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new TaskNoteOpError(`${key} must be an array of strings`);
  }
  return value as string[];
}

function linkList(raw: Raw, key: string): TaskNoteLink[] | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new TaskNoteOpError(`${key} must be an array of links`);
  const links = value.map(normalizeTaskNoteLink);
  if (links.some((l) => l === null)) throw new TaskNoteOpError(`${key}: each link needs a kind and a label or href`);
  return links as TaskNoteLink[];
}

/** Common words agents and the mock use for bug severity, mapped onto BUG_SEVERITIES. */
const SEVERITY_ALIASES: Record<string, string> = { blocking: "blocker", critical: "blocker", major: "high", minor: "low", trivial: "low" };

function oneOf<T extends string>(raw: Raw, key: string, allowed: readonly T[]): T | undefined {
  let value = str(raw, key, 40)?.trim().toLowerCase();
  if (value && key === "severity") value = SEVERITY_ALIASES[value] ?? value;
  if (!value) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TaskNoteOpError(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** Validate untrusted input (HTTP body or MCP arguments) into a typed operation. */
export function parseTaskNoteOp(input: unknown): { ok: true; op: TaskNoteOp } | { ok: false; error: string } {
  try {
    if (!input || typeof input !== "object") throw new TaskNoteOpError("op is required");
    const raw = input as Raw;
    const name = oneOf(raw, "op", TASK_NOTE_OP_NAMES);
    if (!name) throw new TaskNoteOpError("op is required");
    const id = str(raw, "id", 80)?.trim() || undefined;
    const match = str(raw, "match", 300)?.trim() || undefined;
    const target = () => {
      if (!id && !match) throw new TaskNoteOpError("id or match is required");
      return { ...(id ? { id } : {}), ...(match ? { match } : {}) };
    };
    switch (name) {
      case "set_status_update": {
        if (!raw.statusUpdate || typeof raw.statusUpdate !== "object") throw new TaskNoteOpError("statusUpdate is required");
        const fields = raw.statusUpdate as Raw;
        const statusUpdate: TaskStatusUpdate = {
          summary: reqStr(fields, "summary", 1000),
          whatChanged: reqStr(fields, "whatChanged", 1000),
          currentState: reqStr(fields, "currentState", 1000),
          nextStep: reqStr(fields, "nextStep", 1000),
        };
        return { ok: true, op: { op: name, statusUpdate } };
      }
      case "set_summary":
        return { ok: true, op: { op: name, text: str(raw, "text", 4000) ?? "" } };
      case "set_status": {
        const status = str(raw, "status", 40)?.trim();
        const text = str(raw, "text", 1000);
        if (!status && text === undefined) throw new TaskNoteOpError("status or text is required");
        if (status && !isTaskNoteStatus(status)) {
          throw new TaskNoteOpError("status must be one of: todo, planning, in-progress, needs-you, blocked, draft-pr, ready-for-review, done");
        }
        return { ok: true, op: { op: name, ...(status ? { status } : {}), ...(text !== undefined ? { text } : {}) } };
      }
      case "set_rank": {
        const rank = str(raw, "rank", 64)?.trim();
        if (rank && !isRank(rank)) throw new TaskNoteOpError("rank must be lowercase letters and digits, not ending in 0 (use storyboard_position to compute one)");
        return { ok: true, op: { op: name, ...(rank ? { rank } : {}) } };
      }
      case "add_question": {
        const options = normalizeQuestionOptions(strList(raw, "options") ?? []);
        return { ok: true, op: { op: name, text: reqStr(raw, "text", 600), ...(options.length ? { options } : {}) } };
      }
      case "resolve_question":
        return {
          ok: true,
          op: { op: name, ...target(), answer: str(raw, "answer", 1000)?.trim(), reopen: raw.reopen === true },
        };
      case "add_decision":
        return {
          ok: true,
          op: {
            op: name,
            title: reqStr(raw, "title", 160),
            why: str(raw, "why", 800)?.trim() || undefined,
            alternatives: strList(raw, "alternatives"),
          },
        };
      case "add_media": {
        const url = str(raw, "url", 2000)?.trim() || undefined;
        const assetPath = str(raw, "assetPath", 500)?.trim() || undefined;
        if (!url && !assetPath) throw new TaskNoteOpError("url or assetPath is required");
        return {
          ok: true,
          op: {
            op: name,
            url,
            assetPath,
            caption: str(raw, "caption", 300)?.trim() || undefined,
            phase: oneOf(raw, "phase", ["before", "after"] as const),
            kind: oneOf(raw, "kind", ["image", "video"] as const),
          },
        };
      }
      case "add_bug":
        return {
          ok: true,
          op: {
            op: name,
            title: reqStr(raw, "title", 160),
            details: str(raw, "details", 600)?.trim() || undefined,
            severity: oneOf(raw, "severity", BUG_SEVERITIES),
            status: oneOf(raw, "status", BUG_STATUSES),
          },
        };
      case "set_bug_status": {
        const status = oneOf(raw, "status", BUG_STATUSES);
        if (!status) throw new TaskNoteOpError("status is required");
        const resolution = str(raw, "resolution", 600)?.replace(/\s+/g, " ").trim() || undefined;
        return { ok: true, op: { op: name, ...target(), status, severity: oneOf(raw, "severity", BUG_SEVERITIES), ...(resolution ? { resolution } : {}) } };
      }
      case "add_waypoint":
        return { ok: true, op: { op: name, title: reqStr(raw, "title", 160), done: raw.done === false ? false : true } };
      case "add_poi": {
        const file = str(raw, "file", 300)?.trim() || undefined;
        const note = str(raw, "note", 600)?.trim() || undefined;
        if (!file && !note) throw new TaskNoteOpError("file or note is required");
        return { ok: true, op: { op: name, file, note: note ?? "" } };
      }
      case "append_log":
        return { ok: true, op: { op: name, message: reqStr(raw, "message", 600), at: str(raw, "at", 20)?.trim() || undefined } };
      case "add_user_note":
        return { ok: true, op: { op: name, text: reqStr(raw, "text", 4000) } };
      case "set_meta": {
        const status = str(raw, "status", 40)?.trim() || undefined;
        if (status && !isTaskNoteStatus(status)) {
          throw new TaskNoteOpError("status must be one of: todo, planning, in-progress, needs-you, blocked, draft-pr, ready-for-review, done");
        }
        const op: TaskNoteOp = {
          op: name,
          status,
          tags: strList(raw, "tags"),
          models: strList(raw, "models"),
          links: linkList(raw, "links"),
          addTags: strList(raw, "addTags"),
          addModels: strList(raw, "addModels"),
          addLinks: linkList(raw, "addLinks"),
        };
        if (Object.entries(op).every(([key, value]) => key === "op" || value === undefined)) {
          throw new TaskNoteOpError("set_meta needs at least one of status, tags, models, links, addTags, addModels, addLinks");
        }
        return { ok: true, op };
      }
      case "remove_item":
        return { ok: true, op: { op: name, section: oneOf(raw, "section", TASK_NOTE_SECTION_KEYS) ?? failSection(), ...target() } };
      case "clear_section":
        return { ok: true, op: { op: name, section: oneOf(raw, "section", TASK_NOTE_SECTION_KEYS) ?? failSection() } };
    }
  } catch (error) {
    if (error instanceof TaskNoteOpError) return { ok: false, error: error.message };
    throw error;
  }
}

function failSection(): never {
  throw new TaskNoteOpError(`section must be one of: ${TASK_NOTE_SECTION_KEYS.join(", ")}`);
}

/** Replace an item block only when its content actually changed, so a repeat call is a true no-op. */
function upsert(list: NoteBlock[], index: number, next: NoteBlock): void {
  const prev = list[index];
  if (!prev) {
    list.push(next);
    return;
  }
  if (signature(prev) === signature(next)) return;
  list[index] = { ...next, id: prev.id ?? next.id };
}

function findItem(list: NoteBlock[], target: { id?: string; match?: string }, text: (b: NoteBlock) => string): number {
  if (target.id) {
    const byId = list.findIndex((block) => block.id === target.id);
    if (byId >= 0) return byId;
  }
  if (target.match) {
    const wanted = normalizeKey(target.match);
    const exact = list.findIndex((block) => normalizeKey(text(block)) === wanted);
    if (exact >= 0) return exact;
    const partial = list.filter((block) => normalizeKey(text(block)).includes(wanted));
    if (partial.length === 1) return list.indexOf(partial[0]!);
    if (partial.length > 1) throw new TaskNoteOpError(`"${target.match}" matches ${partial.length} items; pass id instead`);
  }
  throw new TaskNoteOpError(target.id ? `No item with id ${target.id}` : `No item matches "${target.match}"`);
}

function paragraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => oneLine(chunk, 1200))
    .filter(Boolean)
    .map((chunk) => makeBlock("paragraph", inlineFromMarkdown(chunk)));
}

/** Rewrite a section body with fresh paragraphs, reusing old blocks when the text is unchanged. */
function replaceParagraphs(existing: NoteBlock[], text: string): NoteBlock[] {
  const next = paragraphBlocks(text);
  if (next.length === existing.length && next.every((block, i) => signature(block) === signature(existing[i]!))) {
    return existing;
  }
  return next;
}

/** Structured fields are plain text, without markdown truncation or markup interpretation. */
function replaceStatusParagraphs(existing: NoteBlock[], lines: string[]): NoteBlock[] {
  const next = lines.map((line) => makeBlock("paragraph", [inlineText(line)]));
  return next.length === existing.length && next.every((block, index) => signature(block) === signature(existing[index]!)) ? existing : next;
}

function formatLogTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function withTerminalPunctuation(value: string): string {
  return /[.!?:]$/.test(value) ? value : `${value}.`;
}

function mediaUrl(op: Extract<TaskNoteOp, { op: "add_media" }>): string {
  if (op.url) {
    const url = op.url.trim();
    if (isExternalMediaUrl(url) || url.startsWith("/api/notes-assets/") || url.startsWith("/api/notes-media/")) return url;
    throw new TaskNoteOpError("url must be http(s) or a DevHub notes asset URL; use assetPath for a notes-relative file");
  }
  return toNoteAssetApiUrl(op.assetPath ?? "");
}

function beginSection(split: SplitTaskNote, key: TaskNoteSectionKey): NoteBlock[] {
  return (split.sections[key] ??= []);
}

function requireMeta(split: SplitTaskNote): TaskNoteMeta {
  if (split.meta === null) {
    throw new TaskNoteOpError("The task-meta block is not valid JSON. Fix it in the editor, then retry.");
  }
  return split.meta;
}

function writeMeta(split: SplitTaskNote, meta: TaskNoteMeta): void {
  const clean = normalizeTaskNoteMeta(meta);
  const body = serializeTaskNoteMeta(clean);
  split.meta = clean;
  if (split.metaBlock) {
    if (blockPlainText(split.metaBlock) === body) return;
    split.metaBlock = { ...split.metaBlock, content: [inlineText(body)] };
    return;
  }
  split.metaBlock = {
    id: crypto.randomUUID(),
    type: "codeBlock",
    props: { ...BASE_PROPS, language: TASK_META_LANG },
    content: [inlineText(body)],
    children: [],
  };
}

/**
 * Apply one operation to a task note. Pure: returns new blocks, never mutates the input.
 * Free-form blocks are carried through by reference; operations are idempotent where a
 * repeat has an obvious meaning (upserts keyed by title/url/file), and `changed` is false
 * when a repeat leaves the note as it was.
 */
export function applyTaskNoteOp(blocks: unknown[], op: TaskNoteOp, ctx: TaskNoteOpContext = {}): TaskNoteOpResult {
  if ((op.op === "remove_item" || op.op === "clear_section") && op.section === "userNotes") {
    throw new TaskNoteOpError("Your notes cannot be removed by task-note operations. Edit them in the note editor.");
  }
  const before = JSON.stringify(blocks);
  const split = splitTaskNote(blocks);
  let message = "";

  switch (op.op) {
    case "set_status_update": {
      split.sections.summary = replaceStatusParagraphs(split.sections.summary ?? [], [oneLine(op.statusUpdate.summary, 1000)]);
      const lines = (Object.keys(STATUS_UPDATE_LABELS) as Array<keyof TaskStatusUpdate>)
        .map((key) => `${STATUS_UPDATE_LABELS[key]}: ${oneLine(op.statusUpdate[key], 1000)}`);
      split.sections.status = replaceStatusParagraphs(split.sections.status ?? [], lines);
      message = "Status update saved";
      break;
    }
    case "set_summary": {
      const next = replaceParagraphs(split.sections.summary ?? [], op.text);
      split.sections.summary = next;
      message = next.length ? "Summary updated" : "Summary cleared";
      break;
    }
    case "set_status": {
      if (op.status) {
        const meta = requireMeta(split);
        writeMeta(split, { ...meta, status: op.status, statusSetAt: meta.status === op.status && meta.statusSetAt ? meta.statusSetAt : (ctx.now ?? new Date()).toISOString() });
      }
      if (op.text !== undefined) split.sections.status = replaceParagraphs(split.sections.status ?? [], op.text);
      message = `Status ${op.status ? `set to ${op.status}` : "text updated"}`;
      break;
    }
    case "set_rank": {
      const { rank: _previous, ...meta } = requireMeta(split);
      writeMeta(split, op.rank ? { ...meta, rank: op.rank } : meta);
      message = op.rank ? `Rank set to ${op.rank}` : "Rank cleared";
      break;
    }
    case "add_question": {
      const list = beginSection(split, "questions");
      const question = splitQuestionOptions(oneLine(op.text));
      const options = normalizeQuestionOptions(op.options ?? question.options ?? []);
      const idx = list.findIndex((b) => normalizeKey(parseQuestion(b).text) === normalizeKey(question.text));
      const content = inlineFromMarkdown(question.text);
      // Options have their own limits; the question body must not truncate them or interpret them as markdown.
      if (options.length) content.push(inlineText(` Options: ${options.join(" | ")}`));
      if (idx < 0) list.push(makeBlock("checkListItem", content, { checked: false }));
      message = idx < 0 ? "Question added" : "Question already present";
      break;
    }
    case "resolve_question": {
      const list = beginSection(split, "questions");
      const idx = findItem(list, op, (b) => parseQuestion(b).text);
      const prev = list[idx]!;
      const nodes = inlineOf(prev);
      const marker = nodes.findIndex((n) => n.type === "text" && n.styles?.bold && n.text === "Answer:");
      const question = (marker >= 0 ? nodes.slice(0, marker) : nodes).map((n) => ({ ...n }));
      const last = question[question.length - 1];
      if (last && last.type === "text" && last.text) last.text = last.text.replace(/\s*→\s*$/, "");
      const answer = op.answer?.trim();
      if (op.reopen) {
        upsert(list, idx, { ...prev, type: "checkListItem", props: { ...prev.props, checked: false }, content: question });
        message = "Question reopened";
      } else {
        const answerNodes = answer
          ? [inlineText(" → "), inlineText("Answer:", { bold: true }), inlineText(` ${oneLine(answer, 1000)}`)]
          : [];
        upsert(list, idx, {
          ...prev,
          type: "checkListItem",
          props: { ...prev.props, checked: true },
          content: [...question, ...answerNodes],
        });
        message = answer ? "Question answered" : "Question marked resolved";
      }
      break;
    }
    case "add_decision": {
      const list = beginSection(split, "decisions");
      const title = withTerminalPunctuation(plainTitle(op.title));
      const alternatives = (op.alternatives ?? []).map((a) => oneLine(a, 160)).filter(Boolean);
      const content: InlineNode[] = [inlineText(title, { bold: true })];
      if (op.why) content.push(...inlineFromMarkdown(` ${op.why}`));
      if (alternatives.length) content.push(inlineText(` Rejected: ${alternatives.join("; ")}.`));
      const idx = list.findIndex((b) => normalizeKey(parseDecision(b).title) === normalizeKey(title));
      upsert(list, idx, makeBlock("bulletListItem", content));
      message = idx < 0 ? "Decision added" : "Decision updated";
      break;
    }
    case "add_media": {
      const list = beginSection(split, "media");
      const url = mediaUrl(op);
      const kind = op.kind ?? (isVideoMediaPath(url) ? "video" : "image");
      const caption = [op.phase ? `${op.phase === "before" ? "Before" : "After"}:` : "", oneLine(op.caption ?? "", 300)]
        .filter(Boolean)
        .join(" ");
      const idx = list.findIndex((b) => b.props?.url === url);
      upsert(
        list,
        idx,
        {
          id: crypto.randomUUID(),
          type: kind,
          props: {
            textAlignment: "left",
            backgroundColor: "default",
            name: url.split("/").pop() ?? "",
            url,
            caption,
            showPreview: true,
          },
          children: [],
        },
      );
      message = idx < 0 ? `${kind === "video" ? "Video" : "Screenshot"} added` : "Media updated";
      break;
    }
    case "add_bug": {
      const list = beginSection(split, "bugs");
      const title = plainTitle(op.title);
      const idx = list.findIndex((b) => normalizeKey(parseBug(b).title) === normalizeKey(title));
      const prev = idx >= 0 ? parseBug(list[idx]!) : undefined;
      const status = op.status ?? prev?.status ?? "open";
      const severity = op.severity ?? prev?.severity;
      const details = op.details ?? prev?.details;
      const lead = [status, severity].filter(Boolean).join(" · ");
      upsert(
        list,
        idx,
        makeBlock("bulletListItem", [
          inlineText(lead, { bold: true }),
          ...inlineFromMarkdown(` ${title}${details ? ` — ${details}` : ""}`),
        ]),
      );
      message = idx < 0 ? "Bug added" : "Bug updated";
      break;
    }
    case "set_bug_status": {
      const list = beginSection(split, "bugs");
      const idx = findItem(list, op, (b) => parseBug(b).title);
      const bug = parseBug(list[idx]!);
      const severity = op.severity ?? bug.severity;
      const lead = [op.status, severity].filter(Boolean).join(" · ");
      upsert(
        list,
        idx,
        makeBlock("bulletListItem", [
          inlineText(lead, { bold: true }),
          ...inlineFromMarkdown(` ${bug.title}${bug.details ? ` — ${bug.details}` : ""}${op.resolution ?? bug.resolution ? ` → Resolved: ${op.resolution ?? bug.resolution}` : ""}`),
        ]),
      );
      message = `Bug marked ${op.status}`;
      break;
    }
    case "add_waypoint": {
      const list = beginSection(split, "waypoints");
      const title = oneLine(op.title, 160);
      const idx = list.findIndex((b) => normalizeKey(parseWaypoint(b).title) === normalizeKey(title));
      // Keep the wording already in the note; a repeat call only flips done.
      const label = idx >= 0 ? parseWaypoint(list[idx]!).title : title;
      upsert(list, idx, makeBlock("checkListItem", inlineFromMarkdown(label), { checked: op.done !== false }));
      message = idx < 0 ? "Waypoint added" : "Waypoint updated";
      break;
    }
    case "add_poi": {
      const list = beginSection(split, "poi");
      const note = oneLine(op.note, 600);
      const content: InlineNode[] = op.file
        ? [inlineText(oneLine(op.file, 300).replace(/`/g, ""), { code: true }), ...(note ? inlineFromMarkdown(`: ${note}`) : [])]
        : inlineFromMarkdown(note);
      const idx = list.findIndex((b) => {
        const item = parsePoi(b);
        return op.file ? item.file === op.file : !item.file && normalizeKey(inlinePlainText(item.note)) === normalizeKey(note);
      });
      upsert(list, idx, makeBlock("bulletListItem", content));
      message = idx < 0 ? "Point of interest added" : "Point of interest updated";
      break;
    }
    case "add_user_note": {
      const list = beginSection(split, "userNotes");
      const at = (ctx.now ?? new Date()).toISOString();
      list.push(makeBlock("bulletListItem", [inlineText(`[${at}] ${op.text.trim()}`)]));
      message = "User note added";
      break;
    }
    case "append_log": {
      const list = beginSection(split, "log");
      const message1 = oneLine(op.message, 600);
      const last = list[list.length - 1];
      // A retried call must not double-log: compare against the previous entry's message.
      if (last && parseLog(last).message === message1) {
        message = "Log entry already present";
        break;
      }
      const at = op.at ?? formatLogTime(ctx.now ?? new Date());
      list.push(makeBlock("bulletListItem", inlineFromMarkdown(`${at} — ${message1}`)));
      message = "Log entry added";
      break;
    }
    case "set_meta": {
      const meta = requireMeta(split);
      const next: TaskNoteMeta = { ...meta };
      if (op.status) {
        next.status = op.status;
        next.statusSetAt = meta.status === op.status && meta.statusSetAt ? meta.statusSetAt : (ctx.now ?? new Date()).toISOString();
      }
      if (op.tags) next.tags = op.tags;
      if (op.addTags) next.tags = [...(next.tags ?? []), ...op.addTags];
      if (op.models) next.models = op.models;
      if (op.addModels) next.models = [...(next.models ?? []), ...op.addModels];
      if (op.links) next.links = op.links;
      if (op.addLinks) next.links = mergeTaskNoteLinks(next.links, op.addLinks);
      writeMeta(split, next);
      message = "Metadata updated";
      break;
    }
    case "remove_item": {
      const list = split.sections[op.section] ?? [];
      const idx = findItem(list, op, (b) => blockPlainText(b) || String(b.props?.url ?? ""));
      list.splice(idx, 1);
      message = `Removed from ${TASK_NOTE_SECTION_HEADING[op.section]}`;
      break;
    }
    case "clear_section": {
      split.sections[op.section] = [];
      message = `${TASK_NOTE_SECTION_HEADING[op.section]} cleared`;
      break;
    }
  }

  const blocksAfter = joinTaskNote(split);
  return { blocks: blocksAfter, changed: JSON.stringify(blocksAfter) !== before, message };
}

/* ───────────────────────── legacy migration ───────────────────────── */

/** What the old scaffold wrote: bold-label lines under a `## Links` heading, plus Date / Jira lines. */
const WORK_LINK_RE = /^\*\*Task:\*\*\s*\[[^\]]*\]\(\/work[^)]*\)\s*$/;
const DATE_LINE_RE = /^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/;

export interface LegacyMigration {
  blocks: NoteBlock[];
  changed: boolean;
}

/**
 * Fold the old bullet-line header into the metadata block, without losing anything.
 *
 *  - `**Date:** …` → `meta.date`
 *  - every `## Links` section: recognised lines (Task / Jira / Repo / PR / …) → `meta.links`,
 *    the `::task-ref` block → kept beside the title; anything unrecognised stays in place
 *    under its original heading.
 *  - a top-of-note `**Jira:** …` line → a Jira link.
 *
 * Idempotent: a note with nothing legacy to fold comes back unchanged (same array).
 * Callers decide whether to persist; opening a note only migrates it in memory.
 */
export function migrateLegacyTaskNote(blocks: unknown[]): LegacyMigration {
  const list = blocks as NoteBlock[];
  const split = splitTaskNote(list);
  if (split.meta === null) return { blocks: list, changed: false };

  const links: TaskNoteLink[] = [];
  const refs: NoteBlock[] = [];
  const seenRefIds = new Set(split.refs.map((r) => String(r.props?.taskId ?? "")));
  let taskId = String(split.refs[0]?.props?.taskId ?? "");
  let date: string | undefined;
  let folded = false;
  const kept: NoteBlock[] = [];

  const consumeLinkBlock = (block: NoteBlock): boolean => {
    if (block.type === "taskRef") {
      const id = String(block.props?.taskId ?? "");
      if (!seenRefIds.has(id)) {
        seenRefIds.add(id);
        refs.push(block);
        taskId ||= id;
      }
      return true;
    }
    if (!isItem(block)) return false;
    const md = blocksToText([block]).replace(/^- (\[[ x]\] )?/, "").trim();
    if (WORK_LINK_RE.test(md)) {
      links.push({ kind: "task", id: taskId || "work", label: "Open in Work", href: "/work?tab=tasks" });
      return true;
    }
    const parsed = parseEntityLinksFromMarkdown(`## Links\n\n${md}`)
      .map(entityRefToTaskNoteLink)
      .filter((l): l is TaskNoteLink => l !== null);
    if (parsed.length === 0) return false;
    links.push(...parsed);
    return true;
  };

  const rest = list.slice(split.title ? 1 : 0);
  let i = 0;
  let sawHeading = false;
  while (i < rest.length) {
    const block = rest[i]!;
    if (!sawHeading && block.type === "paragraph") {
      const md = blocksToText([block]).trim();
      const dateMatch = md.match(DATE_LINE_RE);
      if (dateMatch) {
        date = dateMatch[1];
        folded = true;
        i++;
        continue;
      }
      if (/^\*\*Jira:\*\*/.test(md) && consumeLinkBlock(block)) {
        folded = true;
        i++;
        continue;
      }
    }
    if (isHeading(block)) sawHeading = true;
    if (block.type === "heading" && Number(block.props?.level) === 2 && blockPlainText(block).trim().toLowerCase() === "links") {
      let end = i + 1;
      while (end < rest.length && !isHeading(rest[end]!)) end++;
      const body = rest.slice(i + 1, end);
      const leftover = body.filter((b) => !consumeLinkBlock(b));
      // A Links section whose lines are all unrecognised is left exactly as written.
      if (body.length === 0 || leftover.length < body.length) folded = true;
      if (leftover.length > 0) kept.push(block, ...leftover);
      i = end;
      continue;
    }
    kept.push(block);
    i++;
  }

  if (!folded) return { blocks: list, changed: false };

  const nextMeta: TaskNoteMeta = { ...(split.meta ?? {}) };
  if (date && !nextMeta.date) nextMeta.date = date;
  const mergedLinks = mergeTaskNoteLinks(nextMeta.links, links);
  if (mergedLinks.length) nextMeta.links = mergedLinks;

  const migrated: SplitTaskNote = {
    ...split,
    meta: nextMeta,
    refs: [...split.refs, ...refs],
  };
  writeMeta(migrated, nextMeta);
  const out: NoteBlock[] = [];
  if (split.title) out.push(split.title);
  out.push(migrated.metaBlock!, ...migrated.refs);
  // Anything that was already a standard section or content keeps its relative order.
  out.push(...kept.filter((b) => b !== split.metaBlock && !split.refs.includes(b)));
  return { blocks: out, changed: JSON.stringify(out) !== JSON.stringify(list) };
}

const TASK_REF_MARKER_RE = /^::task-ref\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

/**
 * Add entity links to a task note's header (and its `::task-ref` backlink if the
 * note has none), migrating an old-shape header first. Used when a task's links
 * change, so they land in the metadata block instead of a fresh `## Links` list.
 */
export function addTaskNoteRefs(blocks: unknown[], refs: EntityRef[]): LegacyMigration {
  const migration = migrateLegacyTaskNote(blocks);
  let next = migration.blocks;
  const addLinks = refs.map(entityRefToTaskNoteLink).filter((l): l is TaskNoteLink => l !== null);
  if (addLinks.length > 0) next = applyTaskNoteOp(next, { op: "set_meta", addLinks }).blocks;

  const marker = refs.map((r) => r.marker?.match(TASK_REF_MARKER_RE)).find(Boolean);
  const split = splitTaskNote(next);
  if (marker && split.refs.length === 0 && !next.some((b) => b.type === "taskRef")) {
    split.refs.push({
      id: crypto.randomUUID(),
      type: "taskRef",
      props: { taskId: marker[1], date: marker[2], label: marker[3]?.trim() ?? "" },
      children: [],
    });
    next = joinTaskNote(split);
  }
  return { blocks: next, changed: JSON.stringify(next) !== JSON.stringify(blocks) };
}

/** Convenience for the view and the section ops: migrate, then read. */
export function readTaskNoteWithMigration(blocks: unknown[]): TaskNoteView {
  return readTaskNote(migrateLegacyTaskNote(blocks).blocks);
}

export { safeLinkHref };
