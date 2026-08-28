import { NextRequest, NextResponse } from "next/server";
import { blocksToText } from "@/lib/markdown-convert";
import { extractTags, parseEntityLinksFromMarkdown } from "@/lib/entity-note";
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
  const tags = extractTags(markdown);
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
    tags,
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
