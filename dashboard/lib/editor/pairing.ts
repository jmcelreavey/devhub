import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SelectionSchema, type EditorSelection } from "./selection";
import { editorWorkspace, selectionPath } from "./workspace";
import { AgentDispatchError } from "@/lib/agent-runs/dispatch";

interface Pair { hash: Buffer; workspaceId: string; root: string; expiresAt: number }
interface Pending { selection: EditorSelection; expiresAt: number }
interface EditorInbox { pairs: Map<string, Pair>; selections: Map<string, Pending> }
const host = globalThis as typeof globalThis & { devhubEditorInbox?: EditorInbox };
const inbox = host.devhubEditorInbox ??= { pairs: new Map(), selections: new Map() };
function prune() {
  const now = Date.now();
  for (const [key, pair] of inbox.pairs) if (pair.expiresAt <= now) inbox.pairs.delete(key);
  for (const [key, item] of inbox.selections) if (item.expiresAt <= now) inbox.selections.delete(key);
}
export function pairEditor(workspaceId: string, origin: string) {
  const address = new URL(origin);
  if (address.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) throw new AgentDispatchError("Pair editors from DevHub on this computer.", 400);
  prune();
  const root = editorWorkspace(workspaceId);
  revokeEditor(workspaceId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 30 * 60_000;
  inbox.pairs.set(workspaceId, { hash: createHash("sha256").update(token).digest(), workspaceId, root, expiresAt });
  return { code: Buffer.from(JSON.stringify({ origin: address.origin, workspaceId, root, token })).toString("base64url"), expiresAt };
}
export function revokeEditor(workspaceId: string) {
  inbox.pairs.delete(workspaceId);
  for (const [id, item] of inbox.selections) if (item.selection.workspaceId === workspaceId) inbox.selections.delete(id);
}
export function receiveSelection(token: string, raw: unknown): string {
  prune();
  const selection = SelectionSchema.parse(raw);
  const pair = inbox.pairs.get(selection.workspaceId);
  const hash = createHash("sha256").update(token).digest();
  if (!pair || !timingSafeEqual(pair.hash, hash)) throw new AgentDispatchError("Pairing expired or was revoked. Pair this workspace again in DevHub.", 401);
  if (editorWorkspace(selection.workspaceId) !== pair.root) throw new AgentDispatchError("Workspace changed. Pair it again.", 409);
  selectionPath(pair.root, selection.relativePath);
  if (inbox.selections.size >= 100) throw new AgentDispatchError("Too many pending selections. Clear them in DevHub first.", 429);
  const id = randomUUID();
  inbox.selections.set(id, { selection, expiresAt: Date.now() + 10 * 60_000 });
  return id;
}
export function pendingSelection(id: string): EditorSelection | undefined {
  prune();
  return inbox.selections.get(id)?.selection;
}
export function nextSelection(workspaceId: string): { id: string; selection: EditorSelection } | null {
  prune();
  for (const [id, item] of inbox.selections) if (item.selection.workspaceId === workspaceId) return { id, selection: item.selection };
  return null;
}
export function discardSelection(id: string) { inbox.selections.delete(id); }
