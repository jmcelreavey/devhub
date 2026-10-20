import path from "node:path";
import { randomUUID } from "node:crypto";
import { withMutex } from "@/lib/atomic-write";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { readAgentRun, updateAgentRunStatus } from "@/lib/agent-runs/store";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { withPaseo, paseoUrl } from "@/lib/paseo/client";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { activeTaskRuns, stopTaskWork } from "@/lib/storyboard/stop-task-work";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";
import { setOrchestrationMode } from "@/lib/storyboard/orchestrator";
import { StoryboardError } from "@/lib/storyboard/errors";
import { addUserNote, type AddUserNoteInput, type NoteCapability } from "./add-user-note";
import { resolveReopenTask } from "./reopen-task";
import { resumeTaskAgent } from "./resume-task-agent";
import { willResumeFollowUpSession } from "./task-agent-resume";
import { TaskNoteOpError, updateTaskNoteSections } from "./task-note-sections";

export async function taskNoteCapability(taskId: string): Promise<NoteCapability> {
  const task = await resolveReopenTask(taskId);
  const runs = activeTaskRuns(task.id);
  const auto = readOrchestration(task.id);
  const autoRunning = !!auto && ["starting", "running"].includes(auto.status);
  const autoActive = autoRunning || !!auto && runs.some((run) => auto.runIds.includes(run.runId));
  const latest = runs[0];
  const run = latest ? readAgentRun(latest.runId) : null;
  const liveCandidate = runs.length === 1 && !!run && run.spec.runtime === "paseo" &&
    run.status.state === "running" && run.status.connectionId === paseoUrl() && !!run.status.messageId &&
    !!run.status.conversationId && run.status.conversationId === run.status.sessionId;
  const liveFollowup = !!liveCandidate && await withPaseo(async ({ daemon }) => {
    const fetched = await daemon.fetchAgent(run!.status.conversationId!);
    return fetched?.agent.status === "running" && willResumeFollowUpSession({
      priorDispatchProvider: run!.spec.provider, selectedUiProvider: run!.spec.provider,
      priorSessionId: run!.status.sessionId, priorSupportsResume: fetched.agent.capabilities.supportsSessionPersistence,
    });
  });
  return { running: !!runs.length || autoRunning, auto: autoActive, liveFollowup, confirmNeeded: false, ...(latest ? { runId: latest.runId } : {}) };
}

export async function addTaskUserNote(input: AddUserNoteInput, origin: string) {
  const task = await resolveReopenTask(input.taskId);
  return withPluginMutationLock(path.join(getActiveTasksDir(), ".locks", "add-note-" + task.id), async () => addUserNote({ ...input, taskId: task.id }, {
    capability: taskNoteCapability,
    save: async (request) => {
      const current = await resolveReopenTask(task.id);
      if (current.handoff) throw new TaskNoteOpError("This task has been handed off and is read-only.");
      if (request.noteId) {
        const existing = updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view.userNotes.find((note) => note.id === request.noteId);
        if (!existing || existing.text !== request.text.trim()) throw new TaskNoteOpError("That saved note changed. Refresh before updating the agent.");
        return existing;
      }
      return updateTaskNoteSections({ taskId: task.id }, { op: "add_user_note", text: request.text }).view.userNotes.at(-1)!;
    },
    followup: async (_taskId, runId, guidance, noteId) => withMutex(`paseo:${runId}`, async () => {
      const run = readAgentRun(runId);
      if (!run || !isActiveAgentRunState(run.status.state) || !run.status.conversationId || run.status.connectionId !== paseoUrl()) throw new StoryboardError("The running agent changed. Refresh before sending the note.", 409);
      const messageId = "devhub-note-" + noteId;
      if (run.status.steeringMessageIds?.includes(messageId)) return;
      await withPaseo(async ({ daemon }) => {
        await daemon.sendAgentMessage(run.status.conversationId!, guidance, { messageId, activeTurnBehavior: "steer" });
        const current = readAgentRun(runId) ?? run;
        updateAgentRunStatus(current, { steeringMessageIds: [...new Set([...(current.status.steeringMessageIds ?? []), messageId])] });
      });
    }),
    stop: stopTaskWork,
    resume: async (taskId, guidance) => (await resumeTaskAgent({ taskId, date: task.startDate, origin, guidance })).run.id,
    continueAuto: async (taskId, guidance) => {
      const result = await setOrchestrationMode({ action: "mode", mode: "auto", taskId, idempotencyKey: randomUUID(), guidance }, { origin });
      if (result.dispatchError) throw new StoryboardError(result.dispatchError, 409);
      return result.runId ?? undefined;
    },
  }));
}
