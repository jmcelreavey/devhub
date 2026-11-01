import { AsyncLocalStorage } from "node:async_hooks";
import type { LocalOps } from "./index";

export interface RequestContext {
  workspaceId: string;
  localOps?: Pick<LocalOps, "run" | "git">;
}

const context = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(value: RequestContext, work: () => T): T {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value.workspaceId)) throw new Error("Invalid workspaceId");
  return context.run(value, work);
}

export function requestContext(): RequestContext | undefined {
  return context.getStore();
}
