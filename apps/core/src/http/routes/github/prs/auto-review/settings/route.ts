/**
 * GET/PUT /api/github/prs/auto-review/settings — toggle the in-process auto
 * agent-review poller without editing .env.local.
 *
 * Auth: requireDashboardAuth (same-origin / secret).
 * GET returns `{ enabled, always, ownedOnly, source, intervalMs }`.
 * PUT body `{ enabled?: boolean, always?: boolean, ownedOnly?: boolean }` persists prefs and kicks
 * a poller tick so enable takes effect immediately.
 */
import { z } from "zod";
import { prAutoReviewSettingsGet, prAutoReviewSettingsNative, prAutoReviewSettingsNativeInput, prAutoReviewSettingsSet } from "../../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import {
  readAutoPrReviewPrefs,
  saveAutoPrReviewPrefs,
} from "../../../../../../lib/github/auto-pr-review-prefs";
import {
  autoPrReviewIntervalMs,
  kickAutoPrReviewPoller,
} from "../../../../../../lib/github/auto-pr-review-poller";


const BodySchema = prAutoReviewSettingsNativeInput;

function settingsPayload() {
  const prefs = readAutoPrReviewPrefs();
  return {
    enabled: prefs.enabled,
    always: prefs.always,
    ownedOnly: prefs.ownedOnly,
    source: prefs.source,
    intervalMs: autoPrReviewIntervalMs(),
  };
}

export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(prAutoReviewSettingsGet, {
    input: () => ({}),
    context: () => ({ read: async () => ({ status: 200, body: settingsPayload() }) }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "github.prs.auto-review.settings.get");

export const PUT = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.enabled === undefined && parsed.data.always === undefined && parsed.data.ownedOnly === undefined) {
    return Response.json(
      { error: "Provide at least one of enabled, always, or ownedOnly." },
      { status: 400 },
    );
  }

  const save = async (input: z.output<typeof BodySchema>) => {
    const response = await saveSettings(input);
    return { status: response.status, body: await response.json() };
  };
  if (parsed.data.ownedOnly !== undefined) {
    return httpAction(prAutoReviewSettingsNative, {
      input: () => parsed.data,
      context: () => ({ save }),
      response: (response) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  return httpAction(prAutoReviewSettingsSet, {
    input: () => parsed.data,
    context: () => ({ save }),
    response: (result) => result.kind === "saved"
      ? Response.json(result.response.body, { status: result.response.status })
      : Response.json({ error: "Provide at least one of enabled, always, or ownedOnly." }, { status: 400 }),
  })(req);
}, "github.prs.auto-review.settings.put");

async function saveSettings(input: z.output<typeof BodySchema>) {
  const saved = await saveAutoPrReviewPrefs({
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.always !== undefined ? { always: input.always } : {}),
    ...(input.ownedOnly !== undefined ? { ownedOnly: input.ownedOnly } : {}),
  });

  kickAutoPrReviewPoller();

  return Response.json({
    enabled: saved.enabled,
    always: saved.always,
    ownedOnly: saved.ownedOnly,
    source: saved.source,
    intervalMs: autoPrReviewIntervalMs(),
  });
}
