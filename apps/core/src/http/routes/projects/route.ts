import { projectsCreate, projectsDelete, projectsList } from "../../../../../../packages/shared/actions/projects";
import { withErrorHandler, parseBody } from "../../../lib/api-utils";
import { listProjects, writeProjects } from "../../../lib/projects";


export const GET = withErrorHandler(async () => {
  return Response.json({ projects: projectsList.handler(projectsList.input.parse({}), { execute: listProjects }) });
}, "projects");

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, projectsCreate.input);
  if (!parsed.ok) return parsed.response;
  const { label, repos } = parsed.data;
  const projects = projectsCreate.handler(parsed.data, { execute: () => writeProjects([...listProjects(), { id: "", label, repos }]) });
  return Response.json({ projects });
}, "projects.create");

export const DELETE = withErrorHandler(async (req: Request) => {
  const { id } = projectsDelete.input.parse({ id: new URL(req.url).searchParams.get("id")?.trim() ?? "" });
  if (!id) return Response.json({ error: "Missing group id" }, { status: 400 });
  const projects = projectsDelete.handler({ id }, { execute: () => writeProjects(listProjects().filter((p) => p.id !== id)) });
  return Response.json({ projects });
}, "projects.delete");
