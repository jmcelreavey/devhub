import { NextResponse } from "next/server";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { ProjectCreateSchema } from "@/lib/schemas";
import { listProjects, writeProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ projects: listProjects() });
}, "projects");

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, ProjectCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { label, repos } = parsed.data;
  const projects = writeProjects([...listProjects(), { id: "", label, repos }]);
  return NextResponse.json({ projects });
}, "projects.create");

export const DELETE = withErrorHandler(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "Missing group id" }, { status: 400 });
  const projects = writeProjects(listProjects().filter((p) => p.id !== id));
  return NextResponse.json({ projects });
}, "projects.delete");
