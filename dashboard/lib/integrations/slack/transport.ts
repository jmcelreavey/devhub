import { createSlackClient, type SlackTransport } from "./client";
import { createGatewayClient } from "./gateway-client";
import type { SlackSettings } from "./shared";

export function createSlackTransport(settings: SlackSettings): SlackTransport {
  return settings.mode === "gateway" ? createGatewayClient(settings) : createSlackClient(settings);
}
