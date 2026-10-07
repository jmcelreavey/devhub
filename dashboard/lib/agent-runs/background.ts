import { dispatchAgentRun } from "./dispatch";
import type { AgentActivityContext } from "./run-files";

export interface BackgroundAgentStart {
  channel: "run";
  runId: string;
  conversationId?: string;
  providerLabel: string;
}

export interface BackgroundAgentOptions {
  prompt: string;
  title: string;
  cwd: string;
  provider?: string;
  model?: string;
  requestId?: string;
  activity?: AgentActivityContext;
  unattendedReason?: string;
}

/** No browser, terminal or navigation dependency: the runtime owns execution. */
export async function startBackgroundAgent(opts: BackgroundAgentOptions): Promise<BackgroundAgentStart> {
  // Blank provider/model fall through to the Connection tab default and each harness's configured model.
  const run = await dispatchAgentRun({
    provider: opts.provider?.trim() ?? "", model: opts.model?.trim() || undefined, prompt: opts.prompt, cwd: opts.cwd, title: opts.title,
    worktree: false, depth: 0, unattendedReason: opts.unattendedReason,
    activity: opts.activity, requestId: opts.requestId,
  });
  return { channel: "run", runId: run.spec.id, conversationId: run.status.conversationId, providerLabel: run.spec.providerLabel };
}
