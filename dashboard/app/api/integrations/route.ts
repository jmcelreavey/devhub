import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { providers } from "@/lib/integrations/registry";
import { IntegrationError } from "@/lib/integrations/types";
import { readAccounts } from "@/lib/integrations/accounts";
import { taskRefs } from "@/lib/integrations/task-refs";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { ensureTasksMigrated } from "@/lib/tasks/storage";

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
      accounts: readAccounts(), task: node ? { id: node.task.id, text: node.task.text, refs, addedRefs: node.task.integrationRefs ?? [] } : null,
    });
  } catch (error) { return failure(error); }
}, "integrations.get");
