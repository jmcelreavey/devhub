import { getRunLogPayload } from "../../../../../lib/runs/runner";
import { httpAction } from "../../../../../lib/actions/http";
import { scriptsRunStatus } from "../../../../../../../../packages/shared/actions/scripts";

type Params = { params: Promise<{ runId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
  return httpAction(scriptsRunStatus, {
    input: () => ({ runId }),
    context: () => ({ read: async (id) => {
      const payload = getRunLogPayload(id);
      return payload ? { ok: true, value: payload } : {
        ok: false,
        error: "Run log not found. Logs are kept for completed runs after this update; older history entries have no saved output.",
        status: 404,
      };
    } }),
    response: (result) => result.ok ? Response.json(result.value.run) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}
