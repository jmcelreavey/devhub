import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { suggestWorkItemTitles, WORK_ITEM_TITLES_TIMEOUT_MS } from "@/lib/notes/work-item-titles";
import { blocksToText } from "@/lib/markdown-convert";
import { parseEntityLinksFromMarkdown } from "@/lib/entity-note";
import { getJiraMeta } from "@/lib/jira/client";
import {
  parsePlanWorkItems,
  planTitleFromMarkdown,
  type PlanWorkItem,
} from "@/lib/notes/create-tasks-from";
import { resolveEntityContext } from "@/lib/entity-links/resolve";
import { getVaultStorage } from "@/lib/vault/vault-registry";

export const dynamic = "force-dynamic";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function projectOf(key: string | undefined, fallback = "PTF"): string {
  if (!key) return fallback;
  const prefix = key.split("-")[0]?.toUpperCase();
  return prefix && PROJECT_KEY_RE.test(prefix) ? prefix : fallback;
}

function readNoteMarkdown(notePath: string): string | null {
  const file = getVaultStorage("notes").read(notePath);
  if (!file?.content) return null;
  const blocks = Array.isArray(file.content) ? file.content : [file.content];
  return blocksToText(blocks as Parameters<typeof blocksToText>[0]);
}

export async function GET(req: NextRequest) {
  const notePath = req.nextUrl.searchParams.get("notePath")?.trim();
  if (!notePath) return NextResponse.json({ error: "notePath required" }, { status: 400 });

  const parentKey = req.nextUrl.searchParams.get("parentKey")?.trim().toUpperCase() || null;
  if (parentKey && !JIRA_KEY_RE.test(parentKey)) {
    return NextResponse.json({ error: "parentKey must look like PTF-1234" }, { status: 400 });
  }

  const projectKey =
    req.nextUrl.searchParams.get("projectKey")?.trim().toUpperCase() ||
    projectOf(parentKey ?? undefined);
  if (!PROJECT_KEY_RE.test(projectKey)) {
    return NextResponse.json({ error: "projectKey must be a Jira project key" }, { status: 400 });
  }

  const epicSummary = req.nextUrl.searchParams.get("epicSummary")?.trim() || null;
  const extraRepos = req.nextUrl.searchParams.getAll("repo").map((r) => r.trim()).filter(Boolean);

  const markdown = readNoteMarkdown(notePath);
  if (!markdown) {
    return NextResponse.json({ error: `Note not found: ${notePath}` }, { status: 404 });
  }

  const title = planTitleFromMarkdown(markdown, notePath);
  const workItems: PlanWorkItem[] = parsePlanWorkItems(markdown);
  const noteLinks = parseEntityLinksFromMarkdown(markdown);
  const linkedRepos = [
    ...new Set([
      ...noteLinks.filter((l) => l.kind === "repo").map((l) => l.id),
      ...extraRepos,
    ]),
  ];
  const linkedJira = noteLinks.filter((l) => l.kind === "jira").map((l) => l.id);
  const graph = resolveEntityContext("note", notePath, { label: title, depth: 1 });
  const jiraMeta = await getJiraMeta(projectKey, parentKey ?? linkedJira[0] ?? undefined).catch(
    () => null,
  );

  return NextResponse.json({
    notePath,
    title,
    markdown,
    workItems,
    repos: linkedRepos,
    parentKey,
    epicSummary: epicSummary ?? title,
    projectKey,
    noteLinks,
    related: graph.related,
    jiraMeta,
  });
}

const previewSchema = z.object({
  notePath: z.string().trim().min(1).max(1_000),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, previewSchema);
  if (!parsed.ok) return parsed.response;

  const { notePath } = parsed.data;
  const markdown = readNoteMarkdown(notePath);
  if (!markdown) {
    return NextResponse.json({ error: `Note not found: ${notePath}` }, { status: 404 });
  }

  const title = planTitleFromMarkdown(markdown, notePath);
  const sourceItems = parsePlanWorkItems(markdown);
  let workItems = sourceItems;
  let warning: string | undefined;
  const generationSignal = AbortSignal.any([req.signal, AbortSignal.timeout(WORK_ITEM_TITLES_TIMEOUT_MS)]);
  try {
    workItems = await suggestWorkItemTitles(title, sourceItems, generationSignal);
  } catch (error) {
    if (req.signal.aborted) throw error;
    const timedOut = generationSignal.reason instanceof DOMException && generationSignal.reason.name === "TimeoutError";
    console.warn("[create-tasks-preview] Title suggestions failed:", timedOut ? "TimeoutError" : error instanceof Error ? error.name : "Unknown error");
    warning = `Work items detected, but AI title refinement ${timedOut ? "timed out" : "failed"}. Showing titles taken from the note; you can edit them below.`;
  }

  // The preview needs no Jira lookup; integration metadata is fetched at launch.
  return NextResponse.json({ title, workItems, warning });
}, "notes/create-tasks/preview");
