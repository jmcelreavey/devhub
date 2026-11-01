import { notesPlanLoad, notesPlanPreview } from "../../../../../../../../packages/shared/actions/notes";
import { z } from "zod";
import { AI_PROVIDER_IDS } from "../../../../../lib/ai/preference";
import { formatGenerateError } from "../../../../../lib/ai/generate";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { suggestWorkItemTitles, WORK_ITEM_TITLES_TIMEOUT_MS } from "../../../../../lib/notes/work-item-titles";
import { blocksToText } from "../../../../../../../../packages/shared/ui-lib/markdown-convert";
import { parseEntityLinksFromMarkdown } from "../../../../../../../../packages/shared/ui-lib/entity-note";
import { getJiraMeta } from "../../../../../lib/jira/client";
import {
  parsePlanWorkItems,
  planTitleFromMarkdown,
  type PlanWorkItem,
} from "../../../../../../../../packages/shared/ui-lib/notes/create-tasks-from";
import { resolveEntityContext } from "../../../../../lib/entity-links/resolve";
import { getVaultStorage } from "../../../../../lib/vault/vault-registry";


const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function projectOf(key: string | undefined, fallback = "ABC"): string {
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

export async function GET(req: Request) {
  const input = notesPlanLoad.input.parse({
    notePath: new URL(req.url).searchParams.get("notePath"),
    parentKey: new URL(req.url).searchParams.get("parentKey"),
    projectKey: new URL(req.url).searchParams.get("projectKey"),
    epicSummary: new URL(req.url).searchParams.get("epicSummary"),
    repos: new URL(req.url).searchParams.getAll("repo"),
  });
  return await notesPlanLoad.handler(input, { execute: async (query) => {
    const notePath = query.notePath?.trim();
    if (!notePath) return Response.json({ error: "notePath required" }, { status: 400 });

    const parentKey = query.parentKey?.trim().toUpperCase() || null;
    if (parentKey && !JIRA_KEY_RE.test(parentKey)) {
      return Response.json({ error: "parentKey must look like ABC-1234" }, { status: 400 });
    }

    const projectKey = query.projectKey?.trim().toUpperCase() || projectOf(parentKey ?? undefined);
    if (!PROJECT_KEY_RE.test(projectKey)) {
      return Response.json({ error: "projectKey must be a Jira project key" }, { status: 400 });
    }

    const epicSummary = query.epicSummary?.trim() || null;
    const extraRepos = query.repos.map((r) => r.trim()).filter(Boolean);

    const markdown = readNoteMarkdown(notePath);
    if (!markdown) {
      return Response.json({ error: `Note not found: ${notePath}` }, { status: 404 });
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

    return Response.json({
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
  } }) as Response;
}

const previewSchema = notesPlanPreview.input.extend({ provider: z.enum(AI_PROVIDER_IDS).optional() });

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, previewSchema);
  if (!parsed.ok) return parsed.response;

  return await notesPlanPreview.handler(parsed.data, { execute: async (input) => {
    const { notePath } = input;
    const markdown = readNoteMarkdown(notePath);
    if (!markdown) {
      return Response.json({ error: `Note not found: ${notePath}` }, { status: 404 });
    }

    const title = planTitleFromMarkdown(markdown, notePath);
    const sourceItems = parsePlanWorkItems(markdown);
    if (!input.refineTitles) {
      return Response.json({ title, workItems: sourceItems });
    }

    let workItems = sourceItems;
    let warning: string | undefined;
    const generationSignal = AbortSignal.any([req.signal, AbortSignal.timeout(WORK_ITEM_TITLES_TIMEOUT_MS)]);
    try {
      workItems = await suggestWorkItemTitles(title, sourceItems, generationSignal, {
        provider: parsed.data.provider,
        model: parsed.data.model,
        effort: parsed.data.effort,
      });
    } catch (error) {
      if (req.signal.aborted) throw error;
      const timedOut = generationSignal.reason instanceof DOMException && generationSignal.reason.name === "TimeoutError";
      console.warn("[create-tasks-preview] Title suggestions failed:", timedOut ? "TimeoutError" : error instanceof Error ? error.name : "Unknown error");
      warning = `AI title suggestions ${timedOut ? "timed out" : "failed"}. Your current titles are unchanged.${timedOut ? " Try another model or keep editing." : ` ${formatGenerateError(error)}`}`;
    }

    // The preview needs no Jira lookup; integration metadata is fetched at launch.
    return Response.json({ title, workItems, warning });
  } }) as Response;
}, "notes/create-tasks/preview");
