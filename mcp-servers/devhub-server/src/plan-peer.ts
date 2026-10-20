import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "./context.ts";
import { blocksToText, textToBlocks } from "./convert.ts";

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
    description: "Update only Plan, Acceptance and Open questions in this run's task note. No repository writes, task-stage changes or agent launches.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { plan: z.string().max(40_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two"), acceptance: z.string().max(20_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two"), openQuestions: z.string().max(20_000).refine((text) => !/^#{1,2}\s/m.test(text), "Use subheadings below level two") },
  }, async ({ plan, acceptance, openQuestions }) => {
    const value = await context();
    const note = ctx.storage.read(value.notePath);
    if (!note) throw new Error("Task note not found; open the task in DevHub first.");
    const markdown = blocksToText(note.content as unknown[]);
    ctx.storage.write(value.notePath, textToBlocks(updatePlanSections(markdown, { Plan: plan, Acceptance: acceptance, "Open questions": openQuestions })));
    return { content: [{ type: "text", text: "Task plan updated. No code or task stage changed." }] };
  });
  return server;
}
