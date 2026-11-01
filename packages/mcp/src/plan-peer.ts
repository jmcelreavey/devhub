import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import type { Context } from "./context.ts";
import { readNote, writeNote } from "./content-storage.ts";
import { blocksToText, textToBlocks } from "./convert.ts";
import { applyTaskNoteOp, blockPlainText, parseTaskNoteOp, type NoteBlock } from "../../../packages/shared/task-note/sections.ts";
import { taskQaScenarioInputSchema } from "./qa-scenario-schema.ts";

interface PlanScope { taskId: string; date: string }
interface PlanContext { id: string; notePath: string; done: boolean; abandonedAt?: string | null }

export function updatePlanSections(markdown: string, sections: Record<string, string>): string {
  let result = markdown;
  for (const [title, content] of Object.entries(sections)) {
    const section = `## ${title}\n${content.trim()}\n`;
    const pattern = new RegExp(`^## ${title}\\s*\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))`, "m");
    result = pattern.test(result) ? result.replace(pattern, () => section) : `${result.trimEnd()}\n\n${section}`;
  }
  return result;
}

function containsOutOfScopeHeading(blocks: NoteBlock[]): boolean {
  return blocks.some((block) =>
    (block.type === "heading" && Number(block.props?.level ?? 1) <= 2) ||
    containsOutOfScopeHeading((block.children ?? []) as NoteBlock[]),
  );
}

function updatePlanBlocks(blocks: unknown[], sections: Record<string, string>): NoteBlock[] {
  const next = [...blocks] as NoteBlock[];
  for (const [title, content] of Object.entries(sections)) {
    const headings = next.flatMap((block, index) => block.type === "heading" && Number(block.props?.level) === 2 && blockPlainText(block).trim().toLowerCase() === title.toLowerCase() ? [index] : []);
    if (headings.length > 1) throw new Error(`The task note has more than one ${title} section. Resolve that before updating it.`);
    const replacement = textToBlocks(`## ${title}\n${content.trim()}\n`) as NoteBlock[];
    if (containsOutOfScopeHeading(replacement.slice(1))) throw new Error("Use subheadings below level two");
    const start = headings[0];
    if (start === undefined) {
      next.push(...replacement);
      continue;
    }
    const nextHeading = next.findIndex((block, index) => index > start && block.type === "heading" && Number(block.props?.level ?? 1) <= 2);
    const end = nextHeading < 0 ? next.length : nextHeading;
    next.splice(start + 1, end - start - 1, ...replacement.slice(1));
  }
  return next;
}

export function createTaskPlanServer(ctx: Context, scope: PlanScope): McpServer {
  z.object({ taskId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(scope);
  const server = new McpServer({ name: "devhub-task-plan", version: "1.0.0" });
  const context = async () => {
    const value = await ctx.dashboard.get<PlanContext>(`/api/tasks/implement/plan?taskId=${encodeURIComponent(scope.taskId)}&date=${scope.date}`);
    if (value.id !== scope.taskId || value.done || value.abandonedAt || !/^task-notes\/[\w-]+(?:\.json)?$/.test(value.notePath)) throw new Error("This task's planning scope changed. Reopen the plan in DevHub.");
    return value;
  };
  server.registerTool("task_plan_context", {
    description: "Read this run's task, linked context and existing task note. No writes.", annotations: { readOnlyHint: true },
  }, async () => {
    const value = await context();
    const note = ctx.storage.read(value.notePath);
    return { content: [{ type: "text", text: JSON.stringify({ ...value, note: note ? blocksToText(note.content as unknown[]) : "" }) }] };
  });
  server.registerTool("task_plan_update", {
    description: "Update Plan, Acceptance, Open questions and optional bounded task QA in this run's note. No repository writes, task-stage changes or agent launches.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      plan: z.string().max(40_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two"),
      acceptance: z.string().max(20_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two"),
      openQuestions: z.string().max(20_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two"),
      qaScenario: taskQaScenarioInputSchema.optional().describe("Specific read-only text or visibility assertions; no URL or actions"),
      baselineRequired: z.boolean().optional().describe("True only when a before capture is required before implementation"),
    },
  }, async ({ plan, acceptance, openQuestions, qaScenario, baselineRequired }) => {
    const value = await context();
    const note = await readNote(ctx.noteContent, value.notePath);
    if (!note) throw new Error("Task note not found; open the task in DevHub first.");
    let blocks = updatePlanBlocks(note.content as unknown[], { Plan: plan, Acceptance: acceptance, "Open questions": openQuestions });
    if (qaScenario || baselineRequired) {
      const parsed = parseTaskNoteOp({ op: "set_qa_scenario", qaScenario, baselineRequired });
      if (!parsed.ok) throw new Error(parsed.error);
      blocks = applyTaskNoteOp(blocks, parsed.op).blocks;
    }
    await writeNote(ctx.noteContent, value.notePath, blocks, note.revision);
    return { content: [{ type: "text", text: "Task plan updated. No code or task stage changed." }] };
  });
  return server;
}
