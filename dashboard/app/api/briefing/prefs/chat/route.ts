import { generateText } from "ai";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler, parseBody, isSameOrigin } from "@/lib/api-utils";
import { getZAiNotesModel } from "@/lib/z-ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import {
  normalisePrefsUpdate,
  readBriefingPrefs,
  saveBriefingPrefs,
  type BriefingPrefs,
} from "@/lib/briefing-prefs";
import { BRIEFING_SECTIONS } from "@/lib/briefing-prefs-shared";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message?: string;
  history?: ChatMessage[];
}

const ZAI_OPTIONS = { providerOptions: { zai: { thinking: { type: "disabled" as const } } } } as const;
const AI_TIMEOUT_MS = 8000;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const startObj = raw.indexOf("{");
  const endObj = raw.lastIndexOf("}");
  if (startObj === -1 || endObj <= startObj) return null;
  try {
    return JSON.parse(raw.slice(startObj, endObj + 1));
  } catch {
    return null;
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

function normaliseChatPatch(raw: Record<string, unknown>): Partial<BriefingPrefs> {
  const patch = normalisePrefsUpdate(raw);
  if (raw.sections && typeof raw.sections === "object") {
    const sections = raw.sections as Record<string, unknown>;
    const partial: Partial<BriefingPrefs["sections"]> = {};
    for (const section of BRIEFING_SECTIONS) {
      const value = sections[section.id];
      if (typeof value === "boolean") partial[section.id] = value;
    }
    patch.sections = partial as BriefingPrefs["sections"];
  }
  return patch;
}

function fallbackPatch(message: string): { reply: string; patch: Partial<BriefingPrefs> } {
  const lower = message.toLowerCase();
  const patch: Partial<BriefingPrefs> = {};

  if (/\b(no kids|no children|not got kids|don't have kids|do not have kids)\b/.test(lower)) {
    patch.hasKids = false;
    patch.sections = { attractions: false } as Partial<BriefingPrefs["sections"]> as BriefingPrefs["sections"];
  } else if (/\b(kids|children|family|toddler|school run)\b/.test(lower)) {
    patch.hasKids = true;
    patch.sections = { attractions: true, events: true } as Partial<BriefingPrefs["sections"]> as BriefingPrefs["sections"];
  }

  const tech = ["typescript", "javascript", "react", "node", "python", "go", "rust", "swift", "kotlin", "aws", "terraform"];
  const mentionedTech = tech.filter((t) => lower.includes(t));
  if (mentionedTech.length > 0) {
    patch.techStack = mentionedTech;
    patch.repoLanguages = mentionedTech
      .map((t) => (t === "node" ? "JavaScript" : t[0].toUpperCase() + t.slice(1)))
      .filter((t) => !["Aws", "Terraform"].includes(t));
    patch.sections = { ...(patch.sections ?? {}), devTip: true, github: true, hackerNews: true } as BriefingPrefs["sections"];
  }

  const interestMatch = message.match(/(?:interested in|interests are|i like|i care about)\s+(.+)$/i);
  if (interestMatch) {
    patch.interests = interestMatch[1]
      .replace(/\btoo like\b/gi, ",")
      .replace(/\blike\b/gi, ",")
      .split(/,| and /)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    patch.sections = { ...(patch.sections ?? {}), interests: true } as BriefingPrefs["sections"];
  }

  return {
    reply: "I’ve added those as bespoke interest cards. I’ll use search-backed links for them rather than making you hunt down feeds. What should I tune next?",
    patch,
  };
}

async function aiPatch(current: BriefingPrefs, message: string, history: ChatMessage[]) {
  const model = getZAiNotesModel();
  if (!model || !isNotesAiConfigured()) return fallbackPatch(message);

  try {
    const result = await Promise.race([
      generateText({
        model,
        maxOutputTokens: 1200,
        ...ZAI_OPTIONS,
        prompt: [
          "You are configuring a personal AI morning briefing dashboard through a chat UI.",
          "Be warm, concise, and hand-hold the user. Ask one useful follow-up question at a time.",
          "Turn the user's natural-language answers into a safe prefs patch.",
          "Do not invent RSS URLs or latitude/longitude. If exact coordinates are missing, keep the existing coordinates and ask for them later.",
          "Never ask the user for RSS feed URLs for hobbies/interests. Interests become search-backed bespoke cards automatically.",
          "If they mention kids/family, set hasKids true and enable attractions/events. If they say no kids, disable attractions.",
          "If they mention hobbies/interests, enable interests. If they mention tech, enable devTip/github/hackerNews and tune techStack/repoLanguages.",
          "Output JSON only with shape: {\"reply\": string, \"patch\": object}.",
          "Patch may include only these keys: location, eventSearchAreas, interests, techStack, hasKids, attractionsArea, newsFeeds, newsRegion, repoLanguages, gamingFeeds, sections.",
          `Section IDs: ${BRIEFING_SECTIONS.map((s) => s.id).join(", ")}.`,
          `Current prefs: ${JSON.stringify(current)}`,
          `Recent chat: ${JSON.stringify(history.slice(-8))}`,
          `User just said: ${message}`,
        ].join("\n"),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS)),
    ]);
    if (!result) return fallbackPatch(message);
    const parsed = extractJson(result.text) as { reply?: unknown; patch?: unknown } | null;
    if (!parsed || typeof parsed.reply !== "string" || typeof parsed.patch !== "object" || parsed.patch === null) {
      return fallbackPatch(message);
    }
    return { reply: parsed.reply.slice(0, 600), patch: normaliseChatPatch(parsed.patch as Record<string, unknown>) };
  } catch {
    return fallbackPatch(message);
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await parseBody<ChatRequest>(request);
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  const current = readBriefingPrefs();
  const { reply, patch } = await aiPatch(current, message, body.history ?? []);
  const next = mergePrefs(current, patch);
  await saveBriefingPrefs(next);

  return NextResponse.json({ ok: true, reply, prefs: next });
}, "briefing.prefs.chat");
