import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, isSameOriginStrict, withErrorHandler } from "@/lib/api-utils";
import { providers, providerFor } from "@/lib/integrations/registry";
import { IntegrationError, RefSchema, assertCapability } from "@/lib/integrations/types";
import { AccountSchema, readAccounts, saveAccount } from "@/lib/integrations/accounts";
import { taskRefs, refsRevision, linkTaskRef } from "@/lib/integrations/task-refs";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { ensureTasksMigrated } from "@/lib/tasks/storage";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), provider: RefSchema.shape.provider, account: RefSchema.shape.account, kind: RefSchema.shape.kind, query: z.string().trim().min(1).max(2000), cursor: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.enum(["get", "transitions", "checks"]), ref: RefSchema, cursor: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal("link"), taskId: z.string().min(1).max(100), ref: RefSchema, revision: z.string().length(64), remove: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("account"), account: AccountSchema, remove: z.boolean().default(false) }).strict(),
]);
function failure(error: unknown) {
  if (error instanceof IntegrationError) return NextResponse.json({ error: error.message, kind: error.kind, retryAfter: error.retryAfter }, { status: ({ auth: 401, "rate-limit": 429, "not-found": 404, unsupported: 422, conflict: 409, unavailable: 503, invalid: 400 })[error.kind] });
  // Provider bodies and credential-bearing URLs never reach route logs or clients.
  return NextResponse.json({ error: "The integration returned an invalid or unavailable response.", kind: "unavailable" }, { status: 503 });
}
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  try {
    await ensureTasksMigrated();
    const taskId = req.nextUrl.searchParams.get("taskId");
    const node = taskId ? currentTaskNode(loadTaskIndex(), taskId) : null;
    if (taskId && !node) throw new IntegrationError("not-found", "Task not found.");
    const refs = node ? taskRefs(node.task) : [];
    return NextResponse.json({
      providers: providers().map((p) => ({ id: p.id, label: p.label, capabilities: p.capabilities, accounts: p.accounts() })),
      accounts: readAccounts(), task: node ? { id: node.task.id, text: node.task.text, refs, addedRefs: node.task.integrationRefs ?? [], revision: refsRevision(refs) } : null,
    });
  } catch (error) { return failure(error); }
}, "integrations.get");
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Input); if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    if (input.action === "account" || input.action === "link") {
      if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Manage integrations in the dashboard." }, { status: 403 });
      if (input.action === "account") { await saveAccount(input.account, input.remove); return NextResponse.json({ ok: true }); }
      if (!input.remove) {
        const p = providerFor(input.ref.provider);
        if (!p.accounts().some((a) => a.id === input.ref.account)) throw new IntegrationError("not-found", "Account not found.");
        assertCapability(p, input.ref.kind + ".read");
        await p.get(input.ref, { signal: req.signal });
      }
      await linkTaskRef(input.taskId, input.ref, input.revision, input.remove);
      return NextResponse.json({ ok: true });
    }
    const p = providerFor(input.action === "search" ? input.provider : input.ref.provider);
    const account = input.action === "search" ? input.account : input.ref.account;
    if (!p.accounts().some((a) => a.id === account)) throw new IntegrationError("not-found", "Account not found.");
    const context = { signal: req.signal };
    if (input.action === "search") {
      assertCapability(p, input.kind + ".search");
      if (!p.search) throw new IntegrationError("unsupported", "Search is unavailable.");
      return NextResponse.json(await p.search(account, input.kind, input.query, input.cursor, context));
    }
    if (input.action === "get") { assertCapability(p, input.ref.kind + ".read"); return NextResponse.json(await p.get(input.ref, context)); }
    if (input.action === "transitions" && p.transitions) { assertCapability(p, "issue.transitions"); return NextResponse.json({ items: await p.transitions(input.ref, context) }); }
    if (input.action === "checks" && p.checks) { assertCapability(p, "pr.checks"); return NextResponse.json(await p.checks(input.ref, context, input.cursor)); }
    throw new IntegrationError("unsupported", "This capability is unavailable. Writes use the existing provider flow and workflow approvals.");
  } catch (error) { return failure(error); }
}, "integrations.post");
