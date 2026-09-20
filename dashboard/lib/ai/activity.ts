import { randomUUID } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";
import type { LanguageModelV3Prompt, LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";
import { clip } from "@/lib/agent-runs/events";
import { appendRunEvent, type AgentActivityContext } from "@/lib/agent-runs/run-files";
import { createAgentRun, newAgentRunId, updateAgentRunStatus } from "@/lib/agent-runs/store";
import { getNotesDir } from "@/lib/notes/dir";

export interface AiActivityOptions extends Partial<AgentActivityContext> {
  cwd?: string;
}

interface GenerationOptions {
  provider: string;
  model?: string;
  prompt: string;
  context?: AiActivityOptions;
  signal?: AbortSignal;
}

export function startGenerationActivity(options: GenerationOptions) {
  const { cwd, ...context } = options.context ?? {};
  let run = createAgentRun({
    id: newAgentRunId(),
    schemaVersion: 2,
    runtime: "generation",
    activity: { source: "generation", action: "AI generation", ...context },
    provider: options.provider,
    providerLabel: options.provider === "api" ? "AI generation" : `${options.provider} generation`,
    model: options.model,
    bin: "generation",
    args: [],
    format: "text",
    cwd: cwd || getNotesDir(),
    title: context.action || "AI generation",
    prompt: clip(options.prompt, 16_000),
    depth: 0,
    createdAt: Date.now(),
  });
  run = updateAgentRunStatus(run, { state: "running", startedAt: Date.now(), ownerPid: process.pid });
  let ended = false;
  let text = "";

  function finish(state: "succeeded" | "failed" | "cancelled", error?: string, usage?: LanguageModelV3Usage) {
    if (ended) return;
    ended = true;
    options.signal?.removeEventListener("abort", onAbort);
    appendRunEvent(run.dir, {
      type: "result",
      ok: state === "succeeded",
      text: text || error,
      seq: run.status.eventCount,
      ts: Date.now(),
    });
    run = updateAgentRunStatus(run, {
      state,
      finishedAt: Date.now(),
      resultText: text || undefined,
      eventCount: run.status.eventCount + 1,
      error,
      inputTokens: usage?.inputTokens.total,
      outputTokens: usage?.outputTokens.total,
    });
  }

  function onAbort() {
    finish("cancelled", "Generation cancelled.");
  }

  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  return {
    id: run.spec.id,
    append(value: string) {
      text = (text + value).slice(0, 8_000);
    },
    succeed(usage?: LanguageModelV3Usage) {
      finish("succeeded", undefined, usage);
    },
    fail(error: unknown) {
      const cancelled = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
      finish(cancelled ? "cancelled" : "failed", clip(error instanceof Error ? error.message : String(error), 1_000));
    },
    cancel: onAbort,
  };
}

function promptText(prompt: LanguageModelV3Prompt): string {
  return prompt.map((message) => {
    const content = typeof message.content === "string"
      ? message.content
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    return `${message.role}: ${content}`;
  }).join("\n\n");
}

export function aiActivityMiddleware(context: AiActivityOptions = {}): LanguageModelMiddleware {
  const grouped = { ...context, groupId: context.groupId ?? randomUUID() };
  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, params, model }) {
      const activity = startGenerationActivity({
        provider: "api", model: model.modelId, prompt: promptText(params.prompt), context: grouped, signal: params.abortSignal,
      });
      try {
        const result = await doGenerate();
        for (const part of result.content) if (part.type === "text") activity.append(part.text);
        if (result.finishReason.unified === "error") activity.fail("The model reported a generation error.");
        else activity.succeed(result.usage);
        return result;
      } catch (err) {
        activity.fail(err);
        throw err;
      }
    },
    async wrapStream({ doStream, params, model }) {
      const activity = startGenerationActivity({
        provider: "api", model: model.modelId, prompt: promptText(params.prompt), context: grouped, signal: params.abortSignal,
      });
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        let finished = false;
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                if (!finished) activity.fail("The model stream ended without a completion result.");
                reader.releaseLock();
                controller.close();
                return;
              }
              const part = next.value;
              if (part.type === "text-delta") activity.append(part.delta);
              if (part.type === "error") activity.fail(part.error);
              if (part.type === "finish") {
                finished = true;
                if (part.finishReason.unified === "error") activity.fail("The model reported a generation error.");
                else activity.succeed(part.usage);
              }
              controller.enqueue(part);
            } catch (err) {
              activity.fail(err);
              reader.releaseLock();
              controller.error(err);
            }
          },
          async cancel(reason) {
            activity.cancel();
            await reader.cancel(reason);
            reader.releaseLock();
          },
        });
        return { ...result, stream };
      } catch (err) {
        activity.fail(err);
        throw err;
      }
    },
  };
}
