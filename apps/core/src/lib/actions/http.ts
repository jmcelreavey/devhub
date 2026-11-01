import type { z } from "zod";
import type { ActionDefinition } from "../../../../../packages/shared/actions/define";
import { withErrorHandler } from "../api-utils";
import { formatZodError } from "../schemas";

interface HttpAdapter<Context, Result, Args extends unknown[]> {
  input: (request: Request, ...args: Args) => unknown | Promise<unknown>;
  context: (request: Request, ...args: Args) => Context | Promise<Context>;
  response: (result: Result) => Response | Promise<Response>;
  authorize?: (request: Request, ...args: Args) => Response | undefined | Promise<Response | undefined>;
}

export function httpAction<Schema extends z.ZodObject, Context, Result, Args extends unknown[]>(
  action: ActionDefinition<Schema, Context, Result>,
  adapter: HttpAdapter<Context, Result, Args>,
): (request: Request, ...args: Args) => Promise<Response> {
  if (!("method" in action.http)) throw new Error(`HTTP action unavailable: ${action.http.reason}`);
  const label = `${action.http.method} ${action.http.path}`;
  return withErrorHandler(async (request: Request, ...args: Args) => {
    const denied = await adapter.authorize?.(request, ...args);
    if (denied) return denied;
    let raw: unknown;
    try {
      raw = await adapter.input(request, ...args);
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      throw error;
    }
    const input = await action.input.safeParseAsync(raw);
    if (!input.success) return Response.json({ error: formatZodError(input.error) }, { status: 400 });
    const result = await action.handler(input.data, await adapter.context(request, ...args));
    return adapter.response(result);
  }, label);
}
