import { notificationsRead, notificationsUpdate, notificationsPrefs } from "../../../../../../packages/shared/actions/misc-ui";
import { activeTaskProfile, taskProfileConflict } from "../../../domains/tasks/profile-request";
import { readNotifications, readNotificationSources } from "../../../domains/notifications/sources";
import { updateNotificationState, writeNeedsYouOwnedReposOnly, writeNotificationSourcePrefs } from "../../../domains/notifications/state";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";

function guard(request: Request) {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const profile = new URL(request.url).searchParams.get("profile");
  return profile ? taskProfileConflict(profile) : null;
}
export const GET = withErrorHandler(async (request: Request) => {
  const denied = guard(request);
  if (denied) return denied;
  const profile = activeTaskProfile();
  return notificationsRead.handler({}, { execute: async () => {
    const feed = await readNotifications(profile, request);
    return taskProfileConflict(profile) ?? Response.json(feed, { headers: { "Cache-Control": "no-store" } });
  } }) as Promise<Response>;
}, "notifications.get");
export const POST = withErrorHandler(async (request: Request) => {
  const denied = guard(request);
  if (denied) return denied;
  const profile = activeTaskProfile();
  const parsed = await parseBody(request, notificationsUpdate.input);
  if (!parsed.ok) return parsed.response;
  return notificationsUpdate.handler(parsed.data, { execute: async ({ ids, action, versions }) => {
    // Save the version the person saw; refreshing sources first could dismiss a newer event.
    const items = versions ?? (await readNotificationSources(profile, request)).items;
    const conflict = taskProfileConflict(profile);
    if (conflict) return conflict;
    await updateNotificationState(profile, items, ids, action);
    return Response.json({ ok: true });
  } }) as Promise<Response>;
}, "notifications.post");
export const PUT = withErrorHandler(async (request: Request) => {
  const denied = guard(request);
  if (denied) return denied;
  const parsed = await parseBody(request, notificationsPrefs.input);
  if (!parsed.ok) return parsed.response;
  return notificationsPrefs.handler(parsed.data, { execute: async ({ ownedReposOnly, sources }) => {
    const updated: Record<string, unknown> = {};
    if (ownedReposOnly !== undefined) { await writeNeedsYouOwnedReposOnly(ownedReposOnly); updated.ownedReposOnly = ownedReposOnly; }
    if (sources !== undefined) updated.sources = await writeNotificationSourcePrefs(sources);
    return Response.json({ ok: true, ...updated });
  } }) as Promise<Response>;
}, "notifications.put");
