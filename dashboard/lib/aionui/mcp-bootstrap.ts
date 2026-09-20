import type { AionSession } from "./session";
import { ensureAionMcpEnabled } from "@/lib/sync/aionui-mcp";

/** Best-effort: keep DevHub-managed MCP servers enabled in the connected AionUi workspace. */
export async function ensureAionMcpBootstrap(session: AionSession): Promise<number> {
  try {
    return await ensureAionMcpEnabled(session);
  } catch {
    return 0;
  }
}
