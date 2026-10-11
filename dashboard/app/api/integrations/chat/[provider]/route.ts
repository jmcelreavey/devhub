import { NextRequest, NextResponse } from "next/server";
import { authenticateChat, handleChat } from "@/lib/integrations/chat";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { IntegrationError } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";
async function boundedBody(req: Request) {
  if (Number(req.headers.get("content-length")) > 32768) throw new IntegrationError("invalid", "Command is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new IntegrationError("invalid", "Missing command.");
  const chunks: Uint8Array[] = []; let size = 0;
  const timeout = setTimeout(() => void reader.cancel(), 2000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new IntegrationError("invalid", "Command is too large."); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (provider !== "slack" && provider !== "telegram") return NextResponse.json({ error: "Unsupported chat provider." }, { status: 404 });
    const raw = await boundedBody(req);
    const command = authenticateChat(provider, req.headers, raw, alertProfile());
    let reply: { text: string; duplicate: boolean };
    try { reply = await handleChat(command); }
    catch (error) {
      reply = { duplicate: false, text: error instanceof IntegrationError && error.kind === "rate-limit"
        ? "Command limit reached. Wait before trying again."
        : "Could not queue that action. Check the action JSON and allowed account, then use /devhub help. Nothing was sent to Jira or GitHub." };
    }
    if (provider === "slack") return NextResponse.json({ response_type: "ephemeral", text: reply.text });
    // Telegram supports a method in the webhook response. Replayed updates send no duplicate reply.
    return NextResponse.json(reply.duplicate ? { ok: true } : { method: "sendMessage", chat_id: command.principal.channel, text: reply.text });
  } catch (error) {
    const status = error instanceof IntegrationError && error.kind === "auth" ? 403 : error instanceof IntegrationError && error.kind === "rate-limit" ? 429 : 400;
    return NextResponse.json({ error: status === 403 ? "Chat authentication or allowlist check failed." : status === 429 ? "Command limit reached. Try again later." : "Invalid command. Use /devhub help and check the action JSON." }, { status });
  }
}
