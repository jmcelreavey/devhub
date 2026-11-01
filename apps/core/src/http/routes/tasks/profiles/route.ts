import { taskProfilesRead, taskProfilesWrite } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { activeTaskProfile } from "../../../../domains/tasks/profile-request";
import {
  adoptLegacyIntoActive,
  createAndActivateProfile,
  deleteProfile,
  getTaskProfileList,
  getTaskProfileOverview,
  ProfileError,
  switchProfile,
} from "../../../../domains/tasks/profiles";


/** Profiles, which one this machine writes to, and the other profiles' open tasks (read-only). */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const input = taskProfilesRead.input.parse({ identity: new URL(req.url).searchParams.get("identity") === "1", picker: new URL(req.url).searchParams.get("picker") === "1" });
  return taskProfilesRead.handler(input, { execute: async ({ identity, picker }) => {
    if (identity) {
      return Response.json({ active: activeTaskProfile() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (picker) {
      return Response.json(getTaskProfileList(), { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(getTaskProfileOverview());
  } });
}, "tasks.profiles.get");

/**
 * `create` makes the profile (the first one adopts existing flat day-files) and
 * activates it; `switch` activates an existing one; `adopt` moves stray flat
 * day-files into the active profile; `delete` removes a profile that is neither active nor the
 * default, moving its tasks to `moveTo` first (git mv). Activation is per-machine, not committed.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskProfilesWrite.input.shape.body);
  if (!parsed.ok) return parsed.response;
  const input = taskProfilesWrite.input.parse({ body: parsed.data, picker: new URL(req.url).searchParams.get("picker") === "1" });
  return taskProfilesWrite.handler(input, { execute: async ({ body: { action, id, moveTo }, picker }) => {
    if (picker && (action === "adopt" || action === "delete" || (action === "create" && getTaskProfileList().mode === "legacy"))) {
      return Response.json({ error: "Profile deletion and legacy adoption are unavailable on Today." }, { status: 409 });
    }
    const overview = () => picker ? getTaskProfileList() : getTaskProfileOverview();

    if (action === "adopt") {
      return Response.json({ adopted: adoptLegacyIntoActive(), ...getTaskProfileOverview() });
    }
    if (!id) return Response.json({ error: "A profile id is required." }, { status: 400 });

    if (action === "delete") {
      try {
        const { moved } = await deleteProfile(id, moveTo);
        return Response.json({ deleted: id, moved, ...getTaskProfileOverview() });
      } catch (error) {
        if (error instanceof ProfileError) return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
    }
    if (action === "create") {
      const { adopted } = createAndActivateProfile(id);
      return Response.json({ adopted, ...overview() }, { status: 201 });
    }
    if (!switchProfile(id)) {
      return Response.json({ error: `No profile named "${id}".` }, { status: 404 });
    }
    return Response.json(overview());
  } });
}, "tasks.profiles.post");
