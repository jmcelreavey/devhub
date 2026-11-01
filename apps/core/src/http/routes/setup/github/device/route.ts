import { setupGithubDevice } from "../../../../../../../../packages/shared/actions/setup";
import { parseBody } from "../../../../../lib/api-utils";
import { GithubDeviceLoginSchema } from "../../../../../lib/schemas";
import { pollDeviceLogin, startDeviceLogin } from "../../../../../lib/github/device-login";



/**
 * GitHub device-flow login, driven from the setup wizard.
 *
 * `start` asks GitHub for a code to show the user; `poll` checks whether they
 * approved it yet and, once they have, stores the token in `gh`. The access
 * token is never sent to the browser.
 */
export async function POST(req: Request) {
  const parsed = await parseBody(req, GithubDeviceLoginSchema);
  if (!parsed.ok) return parsed.response;

  return await setupGithubDevice.handler({ body: parsed.data }, {
    execute: ({ body }) => deviceLogin(body as typeof parsed.data),
  }) as Response;
}

async function deviceLogin(input: ReturnType<typeof GithubDeviceLoginSchema.parse>) {
  try {
    if (input.action === "start") {
      return Response.json(await startDeviceLogin());
    }
    return Response.json(await pollDeviceLogin(input.id));
  } catch (err) {
    return Response.json(
      { status: "error", message: err instanceof Error ? err.message : "GitHub sign-in failed." },
      { status: 500 },
    );
  }
}
