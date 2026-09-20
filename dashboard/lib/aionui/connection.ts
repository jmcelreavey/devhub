import { createHash } from "node:crypto";
import release from "../../../scripts/aionui-release.json";

export const AIONUI_RELEASE = {
  ui: release.ui,
  uiCommit: release.uiCommit,
  core: release.core,
  coreCommit: release.coreCommit,
} as const;

export interface AionConnection {
  origin: string;
  userId: string;
  /** An existing marker conversation pins the store as well as the user identity. */
  anchorConversationId: string;
  accessToken?: string;
  csrfToken?: string;
}

export function localAionOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("AionUi needs a valid local web address."); }
  if (!new Set(["127.0.0.1", "[::1]"]).has(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("AionUi must use a loopback IP address (127.0.0.1 or [::1]).");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use the AionUi origin without credentials, a path, or query parameters.");
  }
  return url.origin;
}

export function aionConnectionId(connection: AionConnection): string {
  return createHash("sha256").update(JSON.stringify([
    localAionOrigin(connection.origin), connection.userId, connection.anchorConversationId,
  ])).digest("hex").slice(0, 24);
}

export function aionConversationUrl(origin: string, conversationId: string): string {
  return `${localAionOrigin(origin)}/#/conversation/${encodeURIComponent(conversationId)}`;
}
