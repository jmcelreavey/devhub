import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { TERMINAL_SESSION_KINDS } from "@/lib/terminal-meta";
import {
  listRegisteredTerminalSessions,
  removeTerminalSession,
  upsertTerminalSession,
} from "@/lib/terminal-sessions-registry";

export const dynamic = "force-dynamic";

const TerminalSessionSchema = z
  .object({
    tabId: z.number().finite(),
    sessionId: z.string().nullish(),
    label: z.string().trim().min(1).optional(),
    cwd: z.string().optional(),
    kind: z.enum(TERMINAL_SESSION_KINDS).optional(),
    repoName: z.string().optional(),
    status: z.enum(["connecting", "open", "closed"]).default("connecting"),
    busy: z.boolean().default(false),
    remove: z.boolean().optional(),
  })
  // A removal only needs the tab id; a heartbeat has to name the tab.
  .refine((body) => body.remove === true || Boolean(body.label), {
    path: ["label"],
    message: "label is required",
  });

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ sessions: listRegisteredTerminalSessions() });
}, "terminal.sessions.get");

/** Dock heartbeat — register / update visible tabs. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, TerminalSessionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.remove) {
    removeTerminalSession(body.tabId);
    return NextResponse.json({ ok: true });
  }

  upsertTerminalSession({
    tabId: body.tabId,
    sessionId: body.sessionId ?? null,
    label: body.label!.trim(),
    cwd: body.cwd,
    kind: body.kind,
    repoName: body.repoName,
    status: body.status,
    busy: body.busy,
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}, "terminal.sessions.post");
