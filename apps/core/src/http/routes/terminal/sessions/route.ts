import { terminalHeartbeat, terminalList } from "../../../../../../../packages/shared/actions/terminal";
import { httpAction } from "../../../../lib/actions/http";
import {
  listRegisteredTerminalSessions,
  removeTerminalSession,
  upsertTerminalSession,
} from "../../../../lib/terminal/sessions-registry";


export const GET = httpAction(terminalList, {
  input: () => ({}),
  context: () => ({ list: () => ({ sessions: listRegisteredTerminalSessions() }) }),
  response: (result) => Response.json(result),
});

/** Dock heartbeat — register / update visible tabs. */
export const POST = httpAction(terminalHeartbeat, {
  input: (req) => req.json(),
  context: () => ({ update: (body) => {
    if (body.remove) {
      removeTerminalSession(body.tabId);
      return;
    }
    upsertTerminalSession({
      tabId: body.tabId,
      sessionId: body.sessionId ?? null,
      label: body.label!.trim(),
      cwd: body.cwd,
      kind: body.kind,
      repoName: body.repoName,
      status: body.status,
      busy: body.busy,
      updatedAt: Date.now(),
    });
  } }),
  response: (result) => Response.json(result),
});
