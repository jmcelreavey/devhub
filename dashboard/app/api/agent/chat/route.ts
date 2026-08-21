import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { formatGenerateError, generateAiText } from "@/lib/ai/generate";
import { resolveAiProvider } from "@/lib/ai/preference";
import { flattenAgentChatMessages } from "@/lib/agent-chat";
import { mergeAttachmentsIntoPrompt, parseAgentAttachPayload } from "@/lib/agent-attach";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Turns are capped so a runaway client cannot post an unbounded history. */
const ChatTurnSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().trim().min(1).max(32_000),
});

const AgentChatSchema = z.object({
  messages: z.array(ChatTurnSchema).max(40).default([]),
  cwd: z.string().optional(),
  attachments: z.unknown().optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, AgentChatSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const messages = body.messages;
  if (messages.length === 0) {
    return NextResponse.json({ ok: false, error: "messages are required" }, { status: 400 });
  }

  const resolved = resolveAiProvider();
  if (!resolved.provider) {
    return NextResponse.json(
      { ok: false, error: resolved.setupHint ?? "No AI provider available.", setupHint: resolved.setupHint },
      { status: 503 },
    );
  }

  const cwd = body.cwd?.trim() || undefined;
  const attachments = parseAgentAttachPayload(body.attachments);
  const { system, prompt: flatPrompt } = flattenAgentChatMessages(messages);
  const imageMode = resolved.provider === "api" ? "api" : "cli";
  const merged = mergeAttachmentsIntoPrompt({
    text: flatPrompt,
    attachments,
    imageMode,
  });

  try {
    const result = await generateAiText({
      prompt: merged.prompt,
      system,
      // An agentic PR review fetches the diff and reasons over it, and runs
      // contend when several are started together (measured: 15s solo vs
      // 33-36s with eight in flight). 240s of wall clock was the binding
      // constraint, not a hung CLI — the idle guard is what catches those.
      timeoutMs: 900_000,
      idleTimeoutMs: 120_000,
      cwd,
      abortSignal: req.signal,
      ...(merged.images.length > 0 ? { images: merged.images } : {}),
    });
    return NextResponse.json({
      ok: true,
      text: result.text,
      provider: result.provider,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: formatGenerateError(err),
        setupHint: resolved.setupHint,
      },
      { status: 502 },
    );
  }
}, "agent.chat");
