import { generateText } from "ai";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler, parseBody, isSameOrigin } from "@/lib/api-utils";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { buildBriefingContext, contextForPrompt, type BriefingContext } from "@/lib/briefing-context";
import { readCanvas, saveCanvas, resetCanvas, generateCanvasHtml } from "@/lib/briefing-canvas";
import { addFeed, type AddFeedInput, type DynamicFeed } from "@/lib/briefing-feeds";
import { createResearchTask, type ResearchTask } from "@/lib/briefing-tasks";
import {
  readBriefingPrefs,
  saveBriefingPrefs,
  normalisePrefsUpdate,
  type BriefingPrefs,
} from "@/lib/briefing-prefs";
import { normalizeTheme, type CanvasTheme } from "@/lib/briefing-theme";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface DesignRequest {
  message?: string;
  history?: ChatMessage[];
  theme?: CanvasTheme | null;
}

interface DesignPlan {
  reply: string;
  redesign: boolean;
  canvasInstruction: string;
  feeds: AddFeedInput[];
  research: string[];
  prefs: Record<string, unknown>;
  reset?: boolean;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normaliseFeeds(raw: unknown): AddFeedInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f): AddFeedInput => ({
      url: String(f.url ?? ""),
      label: typeof f.label === "string" ? f.label : undefined,
      kind: f.kind === "json" ? "json" : "rss",
      itemsPath: typeof f.itemsPath === "string" ? f.itemsPath : undefined,
      titleField: typeof f.titleField === "string" ? f.titleField : undefined,
      urlField: typeof f.urlField === "string" ? f.urlField : undefined,
    }))
    .filter((f) => /^https?:\/\//i.test(f.url))
    .slice(0, 5);
}

const DESIGN_RE =
  /\b(look|design|redesign|theme|colou?r|layout|dark|light|animat|font|typograph|make it|minimal|neon|retro|glass|style|background|hero|rearrange|reorder|move|bigger|smaller|prominent|emphasi[sz]e|hide|remove the|add a section|section for|card for|grid|clock|widget)\b/i;
const RESEARCH_RE = /\b(research|look into|dig into|deep dive|investigate|find out about|background on|report on)\b/i;

/** Deterministic fallback when AI is unavailable — regex intent detection. */
function fallbackPlan(message: string): DesignPlan {
  const urls = message.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const feeds: AddFeedInput[] = urls.map((url) => ({
    url,
    kind: /\.json(\?|$)|\/api\/|\.json\/|reddit\.com\/.*\.json/i.test(url) ? "json" : "rss",
  }));

  const research: string[] = [];
  const rm = message.match(new RegExp(RESEARCH_RE.source + "\\s+(.+?)(?:[.!?]|$)", "i"));
  if (rm && rm[2]) research.push(rm[2].trim().slice(0, 160));

  const redesign = DESIGN_RE.test(message) || feeds.length > 0;

  const parts: string[] = [];
  if (redesign) parts.push("reworked the layout");
  if (feeds.length) parts.push(`added ${feeds.length} feed${feeds.length > 1 ? "s" : ""}`);
  if (research.length) parts.push(`kicked off background research`);
  const reply = parts.length ? `Done — ${parts.join(", ")}.` : "Tell me how you'd like the briefing to look, what to add, or what to research.";

  return { reply, redesign, canvasInstruction: message, feeds, research, prefs: {} };
}

async function planDesign(message: string, history: ChatMessage[], ctx: BriefingContext): Promise<DesignPlan> {
  if (!isNotesAiConfigured()) return fallbackPlan(message);
  const model = getNotesAiModel();
  if (!model) return fallbackPlan(message);

  try {
    const result = await generateText({
      model,
      maxOutputTokens: 900,
      ...getNotesAiCallOptions(),
      prompt: [
        "You are the controller for a bespoke personal briefing screen. The user chats to reshape it.",
        "Decide what their message means and return a plan as JSON ONLY, shape:",
        '{ "reply": string, "redesign": boolean, "canvasInstruction": string, "feeds": [{"url": string, "label": string, "kind": "rss"|"json", "itemsPath"?: string, "titleField"?: string, "urlField"?: string}], "research": string[], "prefs": object, "reset": boolean }',
        "",
        "Rules:",
        "- redesign=true whenever they want the page to look or be laid out differently, or to show/hide/emphasise something. canvasInstruction = a clear, specific instruction to the front-end designer.",
        "- feeds: only when they ask to pull in a specific source you can name a real URL for (RSS or JSON). Never invent URLs you're unsure of; leave empty instead.",
        "- research: short topics to research in the background (e.g. 'things to do with kids in Northern Ireland this weekend'). Use for one-off asks, not recurring layout.",
        "- prefs: optional patch. Keys allowed: location{name,lat,lon}, interests[], techStack[], hasKids, newsFeeds[], gamingFeeds[], newsRegion. Don't guess coordinates.",
        "- reset=true only if they explicitly ask to start the design over / go back to default.",
        "- reply: one or two warm, concrete sentences. No lists.",
        "",
        "Current design revision: " + readCanvas().revision + (readCanvas().aiAuthored ? " (AI-authored)" : " (default)"),
        "Available data summary: " + JSON.stringify(contextForPrompt(ctx)).slice(0, 4000),
        "Recent chat: " + JSON.stringify(history.slice(-6)),
        "User said: " + message,
      ].join("\n"),
    });

    const parsed = extractJson(result.text);
    if (!parsed) return fallbackPlan(message);

    return {
      reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.slice(0, 500) : "Updated.",
      redesign: parsed.redesign === true,
      canvasInstruction: typeof parsed.canvasInstruction === "string" && parsed.canvasInstruction.trim() ? parsed.canvasInstruction : message,
      feeds: normaliseFeeds(parsed.feeds),
      research: Array.isArray(parsed.research) ? parsed.research.map(String).map((s) => s.trim()).filter((s) => s.length >= 3).slice(0, 4) : [],
      prefs: parsed.prefs && typeof parsed.prefs === "object" ? (parsed.prefs as Record<string, unknown>) : {},
      reset: parsed.reset === true,
    };
  } catch {
    return fallbackPlan(message);
  }
}

function mergePrefs(current: BriefingPrefs, patch: Partial<BriefingPrefs>): BriefingPrefs {
  return {
    ...current,
    ...patch,
    location: patch.location ?? current.location,
    sections: { ...current.sections, ...(patch.sections ?? {}) },
  };
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await parseBody<DesignRequest>(request);
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
  const theme = normalizeTheme(body.theme);

  let ctx = await buildBriefingContext();
  const plan = await planDesign(message, body.history ?? [], ctx);

  // Explicit reset wins.
  if (plan.reset) {
    await resetCanvas();
    return NextResponse.json({ ok: true, reply: plan.reply || "Reset to the default design.", canvasUpdated: true, addedFeeds: [], tasks: [] });
  }

  // Apply feeds.
  const addedFeeds: DynamicFeed[] = [];
  for (const f of plan.feeds) {
    const added = await addFeed(f);
    if (added) addedFeeds.push(added);
  }

  // Apply prefs patch.
  let prefsChanged = false;
  const patch = normalisePrefsUpdate(plan.prefs ?? {});
  if (Object.keys(patch).length > 0) {
    await saveBriefingPrefs(mergePrefs(readBriefingPrefs(), patch));
    prefsChanged = true;
  }

  // Spawn background research.
  const tasks: ResearchTask[] = [];
  for (const topic of plan.research) {
    const t = await createResearchTask(topic);
    if (t) tasks.push(t);
  }

  // Redesign the canvas (also when new feeds arrived, so they actually surface).
  let canvasUpdated = false;
  const wantRedesign = plan.redesign || addedFeeds.length > 0;
  if (wantRedesign) {
    if (addedFeeds.length > 0 || prefsChanged) ctx = await buildBriefingContext({ refresh: true });
    const canvas = readCanvas();
    const instruction =
      addedFeeds.length > 0 && !plan.redesign
        ? `Incorporate the newly added feed(s): ${addedFeeds.map((f) => f.label).join(", ")}. ${plan.canvasInstruction}`
        : plan.canvasInstruction || message;
    const html = await generateCanvasHtml(instruction, contextForPrompt(ctx), canvas.aiAuthored ? canvas.html : null, theme);
    if (html) {
      await saveCanvas(html, instruction);
      canvasUpdated = true;
    }
  }

  let reply = plan.reply;
  if (wantRedesign && !canvasUpdated) {
    reply += isNotesAiConfigured()
      ? " (I couldn't regenerate the layout just now, so I kept the current one — try again in a moment.)"
      : " (AI isn't configured, so I can't redraw the layout — set AI_API_KEY to enable custom designs.)";
  }

  return NextResponse.json({ ok: true, reply, canvasUpdated, addedFeeds, tasks });
}, "briefing.design");
