import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { TERMINAL_SESSION_KINDS } from "@/lib/terminal-meta";
import {
  createTerminalProposal,
  getTerminalProposal,
  listTerminalProposals,
  resolveTerminalProposal,
} from "@/lib/terminal-proposals";

export const dynamic = "force-dynamic";

/** List pending (or all) proposals for the dock / MCP status. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const status = new URL(req.url).searchParams.get("status");
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = getTerminalProposal(id);
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ proposal: p });
  }
  const proposals = listTerminalProposals(
    status === "pending" ||
      status === "approved" ||
      status === "denied" ||
      status === "expired" ||
      status === "injected" ||
      status === "failed"
      ? { status }
      : undefined,
  );
  return NextResponse.json({ proposals });
}, "terminal.propose.get");

const ProposalCreateSchema = z.object({
  command: z.string().trim().min(1, "command is required").max(8_000, "command too long"),
  cwd: z.string().optional(),
  label: z.string().optional(),
  summary: z.string().optional(),
  kind: z.enum(TERMINAL_SESSION_KINDS).optional(),
  repoName: z.string().optional(),
  preferAgentTab: z.boolean().optional(),
  reason: z.string().optional(),
  source: z.enum(["mcp", "api"]).default("api"),
});

/** MCP / API creates a proposal — dock must confirm before inject. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, ProposalCreateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const proposal = createTerminalProposal(parsed.data);
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create proposal" },
      { status: 400 },
    );
  }
}, "terminal.propose.post");

const ProposalResolveSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "deny", "injected", "failed"]),
  finalCommand: z.string().optional(),
  error: z.string().optional(),
});

/** Dock resolves: approve / deny / injected. */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, ProposalResolveSchema);
  if (!parsed.ok) return parsed.response;
  const { id, action, finalCommand, error } = parsed.data;
  const proposal = resolveTerminalProposal(id, action, { finalCommand, error });
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ proposal });
}, "terminal.propose.patch");
