"use client";

import { useCallback, useState } from "react";
import { Bot, Send, Sparkles, User, RotateCcw } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { useToast } from "@/lib/use-toast";
import { readAppTheme } from "@/lib/briefing-theme";
import type { DynamicFeed } from "@/lib/briefing-feeds";
import type { ResearchTask } from "@/lib/briefing-tasks";

interface BriefingDesignChatProps {
  open: boolean;
  onClose: () => void;
  /** Called when the canvas HTML changed and the iframe should reload. */
  onCanvasUpdated: () => void;
  /** Called when feeds/research tasks changed. */
  onSideEffects: () => void;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

interface DesignResponse {
  ok: boolean;
  reply?: string;
  canvasUpdated?: boolean;
  addedFeeds?: DynamicFeed[];
  tasks?: ResearchTask[];
  error?: string;
}

const STARTERS = [
  "Design it as a calm dark dashboard with a big weather hero and a subtle animated background.",
  "Add a section for gaming news and put it near the top.",
  "Research things to do with the kids in Northern Ireland this weekend.",
  "Give it a retro terminal look: monospace, green on black, minimal.",
] as const;

const INTRO: ChatMessage = {
  role: "assistant",
  content:
    "This is your briefing canvas. I control the whole screen, so tell me how it should look, what to show, feeds to pull in, or something to research in the background. Every morning it refreshes the data and keeps the design until you change it.",
};

export function BriefingDesignChat({ open, onClose, onCanvasUpdated, onSideEffects }: BriefingDesignChatProps) {
  const { error: toastError } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO]);

  const submit = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;

      const history = messages.filter((m) => m !== INTRO);
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setDraft("");
      setSending(true);
      try {
        const res = await fetch("/api/briefing/design", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history, theme: readAppTheme() }),
        });
        const json = (await res.json()) as DesignResponse;
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Design request failed");

        const extras: string[] = [];
        if (json.addedFeeds?.length) extras.push(`Added feed: ${json.addedFeeds.map((f) => f.label).join(", ")}.`);
        if (json.tasks?.length) extras.push(`Researching in the background: ${json.tasks.map((t) => t.topic).join("; ")}.`);
        const reply = [json.reply ?? "Done.", ...extras].join(" ");

        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        if (json.canvasUpdated) onCanvasUpdated();
        if (json.addedFeeds?.length || json.tasks?.length) onSideEffects();
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Design request failed");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "That didn't go through. Try rephrasing and I'll have another go." },
        ]);
      } finally {
        setSending(false);
      }
    },
    [messages, onCanvasUpdated, onSideEffects, sending, toastError],
  );

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Design your briefing"
      description="Chat to reshape the whole screen. I write the HTML, CSS and JS in real time."
      maxWidth="max-w-2xl"
      align="top"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => void submit("Reset the design back to the default layout.")}
            disabled={sending}
          >
            <RotateCcw size={11} aria-hidden /> Reset design
          </button>
          <button type="button" className="btn btn-primary text-xs" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="briefing-chat-shell">
        <div className="briefing-chat-starters" aria-label="Suggested prompts">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              className="briefing-chat-starter"
              onClick={() => void submit(starter)}
              disabled={sending}
            >
              <Sparkles size={11} aria-hidden /> {starter}
            </button>
          ))}
        </div>

        <div className="briefing-chat-log" aria-live="polite">
          {messages.map((message, i) => (
            <div key={`${message.role}-${i}`} className={`briefing-chat-row ${message.role === "user" ? "is-user" : "is-ai"}`}>
              <span className="briefing-chat-avatar" aria-hidden>
                {message.role === "user" ? <User size={13} /> : <Bot size={13} />}
              </span>
              <div className="briefing-chat-bubble">{message.content}</div>
            </div>
          ))}
          {sending && (
            <div className="briefing-chat-row is-ai">
              <span className="briefing-chat-avatar" aria-hidden>
                <Bot size={13} />
              </span>
              <div className="briefing-chat-bubble">Designing…</div>
            </div>
          )}
        </div>

        <form
          className="briefing-chat-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          <textarea
            className="input briefing-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Two columns: work on the left (repos, HN), life on the right (weather, events, kids). Warm colours."
            rows={3}
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(draft);
              }
            }}
          />
          <button type="submit" className="btn btn-primary briefing-chat-send" disabled={sending || !draft.trim()}>
            <Send size={13} aria-hidden /> Send
          </button>
        </form>
      </div>
    </ModalShell>
  );
}
