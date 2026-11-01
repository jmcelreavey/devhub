import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { paseoCliPreferences, paseoCliPreferencesInput, paseoCliUpdates } from "../../../../../../../packages/shared/actions/paseo";
import { agentUpdateCommands, cliUpdateStatus } from "../../../../lib/paseo/agent-cli-updates";
import { saveCliUpdatePreferences } from "../../../../lib/paseo/cli-update-state";
import { cliLockStatus } from "../../../../lib/paseo/cli-update-lock";

export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  return httpAction(paseoCliUpdates, {
    input: () => ({ external: new URL(request.url).searchParams.get("external") === "1" }),
    context: () => ({ read: (external) => external
      ? { installed: agentUpdateCommands().map((command) => command.label), lock: cliLockStatus() }
      : cliUpdateStatus() }),
    response: (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } }),
  })(request);
}, "agent.cli-updates");

export const PATCH = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, paseoCliPreferencesInput);
  if (!body.ok) return body.response;
  return httpAction(paseoCliPreferences, {
    input: () => body.data,
    context: () => ({ save: (input) => { saveCliUpdatePreferences(input); return cliUpdateStatus(); } }),
    response: (value) => Response.json(value),
  })(request);
}, "agent.cli-update-preferences");
