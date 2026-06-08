import { NextResponse } from "next/server";
import { addTask, toggleTask, deleteTask, updateTask, abandonTask, reactivateTask, reorderOpenTasks, rolloverTasks, startTaskTimer, stopTaskTimer } from "@/lib/tasks-storage";
import {
  TaskCreateSchema,
  TaskPatchSchema,
  TaskDeleteSchema,
  TaskReorderSchema,
  formatZodError,
} from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";

export const GET = withErrorHandler(async () => {
  const tasks = await rolloverTasks();
  return NextResponse.json({ date: new Date().toISOString().split("T")[0], tasks });
}, "tasks.get");

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = TaskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const task = await addTask(parsed.data.text.trim(), parsed.data.date, parsed.data.due);
  return NextResponse.json(task, { status: 201 });
}, "tasks.post");

export const PATCH = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));

  if (body && typeof body === "object" && "ids" in body) {
    const parsed = TaskReorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    try {
      const tasks = await reorderOpenTasks(parsed.data.ids, parsed.data.date);
      return NextResponse.json({ tasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reorder tasks.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const parsed = TaskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { id, text, done, due, date, status, abandonReason, timer } = parsed.data;

  if (timer) {
    const task = timer === "start" ? await startTaskTimer(id, date) : await stopTaskTimer(id, date);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  }

  if (status === "abandoned") {
    const task = await abandonTask(id, abandonReason, date);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  }

  if (status === "active") {
    const task = await reactivateTask(id, date);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  }

  if (text !== undefined || due !== undefined) {
    const patch: { text?: string; due?: string | null } = {};
    if (text !== undefined) patch.text = text;
    if (due !== undefined) patch.due = due;
    const task = await updateTask(id, patch, date);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  }

  if (done !== undefined) {
    const task = await toggleTask(id, date);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  }

  return NextResponse.json({ error: "Provide text, due, or done" }, { status: 400 });
}, "tasks.patch");

export const DELETE = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = TaskDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const ok = await deleteTask(parsed.data.id, parsed.data.date);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}, "tasks.delete");
