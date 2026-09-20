import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { AionClient } from "./client";
import { currentAionSession } from "./session";
import { aionConnectionId } from "./connection";
import { listAgentRuns } from "@/lib/agent-runs/store";
import { withMutex } from "@/lib/atomic-write";

export interface IndexedConversation {
  id: string; connectionId: string; title: string; assistant: string;
  modifiedAt: number; state: "running" | "needs-attention" | "idle";
}
const file = () => path.join(getNotesDir(), ".config", "aionui-conversations.json");
export function readConversationIndex(): IndexedConversation[] {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("The saved conversation index could not be read.");
  }
}
let indexedAt = 0;
export async function indexAionConversations(): Promise<void> {
  return withMutex(file(), async () => {
    if (Date.now() - indexedAt < 60_000) return;
    const session = await currentAionSession();
    const connectionId = aionConnectionId(session);
    const client = new AionClient(session);
    const rows = new Map(readConversationIndex().map(row => [row.connectionId + ":" + row.id, row]));
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listConversations(cursor);
      for (const conversation of page.items) {
        const metadata = conversation.extra.devhub;
        if (typeof metadata === "object" && metadata && "connection_marker" in metadata) continue;
        rows.set(connectionId + ":" + conversation.id, {
          id: conversation.id, connectionId, title: conversation.name,
          assistant: conversation.assistant?.name || conversation.type,
          modifiedAt: conversation.modified_at,
          state: conversation.runtime?.pending_confirmations ? "needs-attention" : conversation.status === "running" ? "running" : "idle",
        });
      }
      cursor = page.has_more ? page.items.at(-1)?.id : undefined;
      if (cursor && seen.has(cursor)) throw new Error("AionUi repeated a conversation page.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
    const temporary = file() + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify([...rows.values()]), { mode: 0o600 });
    fs.renameSync(temporary, file());
    indexedAt = Date.now();
  });
}

export function directConversations(connectionId?: string) {
  const managed = new Set(listAgentRuns(Number.MAX_SAFE_INTEGER).map(run => run.status.connectionId + ":" + run.status.conversationId));
  return readConversationIndex().filter(row => (!connectionId || row.connectionId === connectionId) && !managed.has(row.connectionId + ":" + row.id))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}
