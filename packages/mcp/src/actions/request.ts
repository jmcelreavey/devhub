import type { ActionResult } from "../../../../packages/shared/actions/result.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export async function dashboardActionRequest<Value>(request: () => Promise<Value>): Promise<ActionResult<Value>> {
  try {
    return { ok: true, value: await request() };
  } catch (error) {
    const result = await withDashboardErrors(async () => { throw error; });
    const message = result.content.find((item) => item.type === "text");
    return { ok: false, error: message?.type === "text" ? message.text : "Unexpected error", status: 0 };
  }
}
