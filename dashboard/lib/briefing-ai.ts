// AI enrichment for the daily briefing. Every function is additive: if AI is
// not configured or the call fails, it falls back to a deterministic result so
// the briefing never breaks.
//
// All calls are cached alongside the briefing data (the API route caches the
// full DailyBriefing object per day), so these run once per refresh — not per
// page load.

import { generateText } from "ai";
import { getZAiNotesModel } from "@/lib/z-ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { pickDevTip, type DailyBriefing, type DevTip, type InterestSnippet } from "./morning-briefing";

const ZAI_OPTIONS = { providerOptions: { zai: { thinking: { type: "disabled" as const } } } } as const;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const startArr = raw.indexOf("[");
  const jsonStart =
    start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (jsonStart === -1) return null;
  const end = raw.lastIndexOf("}");
  const endArr = raw.lastIndexOf("]");
  const jsonEnd = end === -1 ? endArr : endArr === -1 ? end : Math.max(end, endArr);
  if (jsonEnd === -1 || jsonEnd < jsonStart) return null;
  try {
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
}

// ── AI Dev Tip ───────────────────────────────────────────────────────────────

export async function generateAiDevTip(techStack: string[], date: Date): Promise<DevTip | null> {
  if (!isNotesAiConfigured() || techStack.length === 0) {
    return pickDevTip(date);
  }
  const model = getZAiNotesModel();
  if (!model) return pickDevTip(date);

  try {
    const result = await generateText({
      model,
      prompt: [
        `Generate one practical, specific development tip for a developer who works with: ${techStack.join(", ")}.`,
        "The tip must be:",
        "- A real, correct technique (not generic advice)",
        "- Under 35 words",
        "- Actionable today",
        "",
        'Respond as JSON only: {"tag": "<primary-tech>","text": "<the tip>"}',
      ].join("\n"),
      maxOutputTokens: 300,
      ...ZAI_OPTIONS,
    });
    if (!result.text || result.finishReason === "length") return pickDevTip(date);

    const parsed = extractJson(result.text) as { tag?: string; text?: string } | null;
    if (!parsed?.text || typeof parsed.text !== "string" || parsed.text.length < 10) {
      return pickDevTip(date);
    }
    return {
      tag: typeof parsed.tag === "string" && parsed.tag.length > 0 ? parsed.tag.slice(0, 20) : techStack[0],
      text: parsed.text.slice(0, 300),
      aiGenerated: true,
    };
  } catch {
    return pickDevTip(date);
  }
}

// ── AI Summary ───────────────────────────────────────────────────────────────

/** Strips the briefing down to the data the AI needs for a summary (no noise). */
function summariseBriefing(b: DailyBriefing): Record<string, unknown> {
  return {
    weather: b.weather
      ? {
          location: b.weather.location,
          tempC: Math.round(b.weather.currentTempC),
          description: b.weather.days[0]?.description,
          wind: b.weather.windKph,
        }
      : null,
    newsCount: b.news.length,
    topNews: b.news.slice(0, 3).map((n) => n.title),
    eventsCount: b.events.length,
    topEvents: b.events.slice(0, 3).map((e) => e.title),
    reposCount: b.github.length,
    hnCount: b.hackerNews.length,
    onThisDay: b.onThisDay[0] ? `${b.onThisDay[0].year}: ${b.onThisDay[0].text}` : null,
  };
}

export async function generateAiSummary(
  briefing: DailyBriefing,
  profile: { techStack: string[]; interests: string[] },
): Promise<string | null> {
  if (!isNotesAiConfigured()) return null;
  const model = getZAiNotesModel();
  if (!model) return null;

  try {
    const data = JSON.stringify(summariseBriefing(briefing));
    const interestLine = profile.interests.length > 0 ? profile.interests.join(", ") : "none";
    const stackLine = profile.techStack.length > 0 ? profile.techStack.join(", ") : "general";

    const result = await generateText({
      model,
      prompt: [
        "You are writing a one-sentence morning briefing summary for a personal dashboard.",
        `The developer works with: ${stackLine}.`,
        `Their interests: ${interestLine}.`,
        "",
        "Here is today's data:",
        data,
        "",
        "Rules:",
        "- One sentence, maximum 25 words",
        "- Be specific to what's actually in the data (mention a real headline, event, or weather detail)",
        "- Natural and conversational — no lists, no emoji, no fluff",
        "- If the data is mostly empty, just say so briefly",
        "",
        "Respond with the sentence only — no quotes, no JSON.",
      ].join("\n"),
      maxOutputTokens: 200,
      ...ZAI_OPTIONS,
    });
    if (!result.text || result.finishReason === "length") return null;

    const clean = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 200);
    return clean.length > 10 ? clean : null;
  } catch {
    return null;
  }
}

// ── AI Interest Snippets ─────────────────────────────────────────────────────

export async function generateInterestSnippets(interests: string[]): Promise<InterestSnippet[]> {
  if (!isNotesAiConfigured() || interests.length === 0) return [];
  const model = getZAiNotesModel();
  if (!model) return [];

  try {
    const result = await generateText({
      model,
      prompt: [
        "For each of the user's interests below, generate one short, useful insight or tip.",
        "These are evergreen insights (not news) — practical knowledge, techniques, or interesting facts.",
        "",
        `Interests: ${interests.join(", ")}`,
        "",
        "Rules per insight:",
        "- Max 30 words",
        "- Specific and useful (not generic)",
        "- No URLs, no emoji",
        "",
        'Respond as JSON array: [{"interest":"<name>","text":"<insight>"}]',
      ].join("\n"),
      maxOutputTokens: 800,
      ...ZAI_OPTIONS,
    });
    if (!result.text || result.finishReason === "length") return [];

    const parsed = extractJson(result.text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
      .map((item) => ({
        interest: String(item.interest ?? "").slice(0, 40),
        text: String(item.text ?? "").slice(0, 200),
        links: [],
      }))
      .filter((s) => s.interest && s.text.length > 5)
      .slice(0, interests.length);
  } catch {
    return [];
  }
}
