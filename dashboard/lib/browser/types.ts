import { z } from "zod";

export const BrowserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url().max(2000) }).strict(),
  z.object({ kind: z.literal("click"), target: z.string().uuid(), observation: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("type"), target: z.string().uuid(), observation: z.string().uuid(), text: z.string().min(1).max(2000) }).strict(),
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export interface BrowserElement { id: string; role: string; name: string }
export interface BrowserObservation { id: string; url: string; text: string; elements: BrowserElement[]; at: number }
export interface BrowserProposal { id: string; action: BrowserAction; label: string; url: string; expiresAt: number }
export interface BrowserSessionView {
  id: string; taskId: string; runId: string; profile: string; persistent: boolean;
  mode: "human" | "agent" | "taking-control" | "stopped"; origins: string[];
  ready: boolean; error?: string; expiresAt?: number; pending?: BrowserProposal;
  receipt?: { id: string; status: "done" | "failed" | "unknown"; message: string };
  tabs?: { id: string; title: string; url: string }[]; activeTab?: string;
  notice?: string;
  transfer?: { id: string; kind: "upload" | "download"; name: string; origin: string; bytes?: number; expiresAt: number };
  dialog?: { id: string; type: string; message: string };
}
export interface BrowserStatus {
  supported: boolean; installed: boolean; reason?: string; session: BrowserSessionView | null;
}
