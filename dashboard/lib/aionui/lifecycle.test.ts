import { describe, expect, it, vi } from "vitest";
import { archiveFinishedPrReview, isPrReviewRun, managedTurnOutcome } from "./lifecycle";
import { AionRequestError } from "./client";
import { conversationWantsAutoconfirm } from "./contracts";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { AionConversation, aionMessageSchema } from "./contracts";
import type { z } from "zod";
type Message = z.infer<typeof aionMessageSchema>;
const run = { status: { messageId: "mine", turnId: "turn-mine" } } as AgentRun;
const idle: AionConversation = { id: "chat", name: "Chat", type: "acp", created_at: 0, modified_at: 0, extra: {}, status: "finished" };
function message(id: string, position: "left" | "right", content = "reply"): Message {
  return { id, msg_id: id, conversation_id: "chat", type: "text", content: { content }, position, status: "finish", hidden: false, created_at: 0 };
}
describe("turn reconciliation", () => {
  it("never infers success from idle alone", () => {
    expect(managedTurnOutcome(run, idle, [message("mine","right")]).state).toBe("needs-attention");
  });
  it("reports available output without inventing a harness success reason", () => {
    expect(managedTurnOutcome(run, idle, [message("mine","right"),message("reply","left")])).toMatchObject({ state: "completed", resultText: "reply" });
  });
  it("does not attribute the next user's reply or failure to this turn", () => {
    const nextError = { ...message("error","left"), status: "error" as const };
    expect(managedTurnOutcome(run, idle, [message("mine","right"),message("reply","left","my reply"),message("next","right"),nextError])).toMatchObject({ state: "completed", resultText: "my reply" });
  });
  it("reports this turn's error and an acknowledged cancellation separately", () => {
    expect(managedTurnOutcome(run, idle, [message("mine","right"),{ ...message("error","left"), type:"tips", content:{ type:"error",content:"failed" } }])).toMatchObject({ state:"failed",error:"failed" });
    expect(managedTurnOutcome({ ...run,status:{ ...run.status,cancelRequestedAt:1 } },idle,[message("mine","right"),message("partial","left")]).state).toBe("cancelled");
  });
  it("exposes native permission requests without navigating", () => {
    const conversation = { ...idle, runtime:{ state:"waiting_confirmation" as const,can_send_message:false,has_task:true,task_status:"running" as const,is_processing:true,pending_confirmations:1,turn_id:"turn-mine",supports_midturn_delivery:false } };
    expect(managedTurnOutcome(run,conversation,[]).state).toBe("needs-attention");
  });
});

describe("autoconfirm flag", () => {
  it("treats DevHub-managed conversations as autoconfirm", () => {
    expect(conversationWantsAutoconfirm({ ...idle, extra: { devhub: { run_id: "r1", autoconfirm_permissions: true } } })).toBe(true);
    expect(conversationWantsAutoconfirm({ ...idle, extra: { devhub: { run_id: "r1" } } })).toBe(true);
    expect(conversationWantsAutoconfirm(idle)).toBe(false);
  });
});

function reviewRun(action: string, state: AgentRun["status"]["state"] = "completed"): AgentRun {
  return {
    spec: { activity: { source: "auto-review", action } },
    status: { state, conversationId: "chat" },
  } as AgentRun;
}

describe("PR review archive", () => {
  it("archives finished UI and auto-review chats, not other agent work", () => {
    expect(isPrReviewRun(reviewRun("review"))).toBe(true);
    expect(isPrReviewRun(reviewRun("pr-review"))).toBe(true);
    expect(isPrReviewRun(reviewRun("agent"))).toBe(false);
    expect(isPrReviewRun(reviewRun("implement"))).toBe(false);
  });

  it("POSTs archive after a finished review and ignores an already-gone chat", async () => {
    const archiveConversation = vi.fn(async () => undefined);
    await expect(archiveFinishedPrReview({ archiveConversation }, reviewRun("pr-review"))).resolves.toBe(true);
    expect(archiveConversation).toHaveBeenCalledWith("chat");

    archiveConversation.mockRejectedValueOnce(new AionRequestError("gone", 404));
    await expect(archiveFinishedPrReview({ archiveConversation }, reviewRun("review"))).resolves.toBe(true);

    archiveConversation.mockClear();
    await expect(archiveFinishedPrReview({ archiveConversation }, reviewRun("pr-review", "running"))).resolves.toBe(false);
    expect(archiveConversation).not.toHaveBeenCalled();
  });
});
