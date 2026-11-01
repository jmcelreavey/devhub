import { capabilityWorkspaceOpen, capabilityWorkspaceOpenInput } from "../../../../../../../../packages/shared/actions/capability";
import { readLabRecord } from "../../../../../lib/capability/journey";
import { openPathInCursor } from "../../../../../lib/editor/cursor-open";
import { parseBody } from "../../../../../lib/api-utils";


/**
 * Open a lab's hands-on workspace directory in Cursor. The path comes from the
 * lab record (server-side), never from the client, so this can't be used to
 * open arbitrary paths.
 */
const OpenWorkspaceSchema = capabilityWorkspaceOpenInput;

export async function POST(req: Request) {
  const parsed = await parseBody(req, OpenWorkspaceSchema);
  if (!parsed.ok) return parsed.response;
  const category = parsed.data.category;


  return await capabilityWorkspaceOpen.handler(parsed.data, { execute: async () => {
    const record = readLabRecord(category);
    if (!record?.workspacePath) {
      return Response.json({ error: "Lab has no workspace" }, { status: 404 });
    }

    const error = await openPathInCursor(record.workspacePath);
    if (error) return Response.json({ error }, { status: 503 });

    return Response.json({ ok: true, path: record.workspacePath });
  } }) as Response;
}
