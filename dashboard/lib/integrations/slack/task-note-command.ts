import type { KnownBlock } from "@slack/web-api";
import type { AddUserNoteResult } from "@/lib/tasks/add-user-note";
import type { McpCallResult } from "./mcp-catalog";
import type { SlackToolContext, ToolHandlerDeps } from "./tool-handler";
import type { SlackMessage } from "./client";
import { slackTextMessage } from "./format";

export async function taskNoteReply(result: McpCallResult, args: Record<string, unknown>, context: SlackToolContext, confirms: ToolHandlerDeps["confirms"]): Promise<SlackMessage | null> {
  const data = result.structuredContent as (AddUserNoteResult & { target?: string }) | undefined;
  if (result.isError || !data?.saved || !data.note?.id) return null;
  const target = data.target ?? String(args.id);
  const message = data.agent?.error ? "📝 Note saved to " + target + " · " + data.agent.error
    : "📝 Note saved to " + target + (args.updateAgent ? data.agent?.mode === "none" ? " · No agent running" : " · Agent updated" : "");
  const blocks: KnownBlock[] = [{ type: "section", text: { type: "plain_text", text: message.slice(0, 2900) } }];
  if (data.capability?.running && !args.updateAgent) {
    const id = await confirms.create({ kind: "run", tool: "task_note_add", args: { id: args.id, text: data.note.text, noteId: data.note.id, updateAgent: true }, profile: context.profile, teamId: context.teamId, userId: context.userId, channel: context.channel, threadTs: context.threadTs });
    blocks.push({ type: "actions", elements: [{ type: "button", action_id: "devhub_tool_confirm", value: id, text: { type: "plain_text", text: "Update the agent too" } }] });
  }
  return slackTextMessage(context.channel, message, context.threadTs, blocks);
}
