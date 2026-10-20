import { AsyncLocalStorage } from "node:async_hooks";

export interface SlackTransportContext { deviceId: string; eventId?: string }
export const slackTransportContext = new AsyncLocalStorage<SlackTransportContext>();
