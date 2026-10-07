import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isValidProfileId } from "@shared/vault/task-profiles.ts";
import {
  adoptLegacyIntoActive,
  createAndActivateProfile,
  getTaskProfileOverview,
  switchProfile,
} from "@/lib/tasks/profiles";

export const dynamic = "force-dynamic";

const ActionSchema = z.object({
  action: z.enum(["create", "switch", "adopt"]),
  id: z.string().refine(isValidProfileId, "Use lowercase letters, digits, - or _ (max 32)").optional(),
});

/** Profiles, which one this machine writes to, and the other profiles' open tasks (read-only). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(getTaskProfileOverview());
}, "tasks.profiles.get");

/**
 * `create` makes the profile (the first one adopts existing flat day-files) and
 * activates it; `switch` activates an existing one; `adopt` moves stray flat
 * day-files into the active profile. Activation is per-machine, not committed.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ActionSchema);
  if (!parsed.ok) return parsed.response;
  const { action, id } = parsed.data;

  if (action === "adopt") {
    return NextResponse.json({ adopted: adoptLegacyIntoActive(), ...getTaskProfileOverview() });
  }
  if (!id) return NextResponse.json({ error: "A profile id is required." }, { status: 400 });

  if (action === "create") {
    const { adopted } = createAndActivateProfile(id);
    return NextResponse.json({ adopted, ...getTaskProfileOverview() }, { status: 201 });
  }
  if (!switchProfile(id)) {
    return NextResponse.json({ error: `No profile named "${id}".` }, { status: 404 });
  }
  return NextResponse.json(getTaskProfileOverview());
}, "tasks.profiles.post");
