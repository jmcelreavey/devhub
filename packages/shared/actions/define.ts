import { z } from "zod";

export interface ActionAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface HttpActionRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  // A nonempty request condition; shared routes need distinct, mutually exclusive conditions.
  discriminator?: string;
}

export interface ActionDefinition<Schema extends z.ZodObject, Context, Result> {
  input: Schema;
  http: HttpActionRoute | { reason: string };
  mcp: { name: string; description: string; toolset: string; annotations?: ActionAnnotations } | { reason: string };
  handler: (input: z.output<Schema>, context: Context) => Result | Promise<Result>;
}

export function defineAction<Schema extends z.ZodObject, Context, Result>(
  definition: ActionDefinition<Schema, Context, Result>,
): ActionDefinition<Schema, Context, Result> {
  return definition;
}
