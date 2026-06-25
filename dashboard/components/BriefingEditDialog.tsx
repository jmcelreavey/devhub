"use client";

import { useCallback, useMemo, useState } from "react";
import { Bot, RotateCcw, Send, Sparkles, User } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { useToast } from "@/lib/use-toast";
import { DEFAULT_BRIEFING_PREFS, type BriefingPrefs } from "@/lib/briefing-prefs-shared";

interface BriefingEditDialogProps {
  open: boolean;
  onClose: () => void;
  prefs: BriefingPrefs;
  onSaved: () => void;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const STARTERS = [
  "I'm a developer. I care about TypeScript, React, AI tools, F1, gaming, and local family days out.",
  "No kids. Keep it focused on work, tech, local news, and my hobbies.",
  "Make it calmer: fewer cards, more AI summary, less noisy news.",
] as const;

function prefsSummary(prefs: BriefingPrefs): string[] {
  const enabled = Object.entries(prefs.sections)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return [
    prefs.location.name,
    prefs.hasKids ? "family mode" : "no family card",
    `${enabled.length} sections`,
    prefs.techStack.length ? `stack: ${prefs.techStack.join(", ")}` : "no stack yet",
    prefs.interests.length ? `interests: ${prefs.interests.join(", ")}` : "no interests yet",
  ];
}

function SetupChips({ prefs }: { prefs: BriefingPrefs }) {
  return (
    <div className="briefing-chat-summary" aria-label="Current briefing setup">
      {prefsSummary(prefs).map((item) => (
        <span key={item} className="briefing-edit-chip">{item}</span>
      ))}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`briefing-chat-row ${isUser ? "is-user" : "is-ai"}`}>
      <span className="briefing-chat-avatar" aria-hidden>
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </span>
      <div className="briefing-chat-bubble">{message.content}</div>
    </div>
  );
}

export function BriefingEditDialog({ open, onClose, prefs, onSaved }: BriefingEditDialogProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [livePrefs, setLivePrefs] = useState<BriefingPrefs>(prefs);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Tell me what your morning briefing should care about. Mention where you are, whether family/kids matter, your work stack, and hobbies. I’ll tune it as we go.",
    },
  ]);

  const currentPrefs = useMemo(() => (open ? livePrefs : prefs), [open, livePrefs, prefs]);

  const submit = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || saving) return;

    const nextHistory: ChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextHistory);
    setDraft("");
    setSaving(true);
    try {
      const res = await fetch("/api/briefing/prefs/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages }),
      });
      if (!res.ok) throw new Error("Failed to tune briefing");
      const json = (await res.json()) as { reply?: string; prefs?: BriefingPrefs };
      if (json.prefs) setLivePrefs(json.prefs);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: json.reply ?? "Updated. What else should I tune?",
        },
      ]);
      onSaved();
    } catch {
      toastError("Failed to tune briefing");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "That didn’t save. Try saying it another way and I’ll have another crack." },
      ]);
    } finally {
      setSaving(false);
    }
  }, [messages, onSaved, saving, toastError]);

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/briefing/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(DEFAULT_BRIEFING_PREFS),
      });
      if (!res.ok) throw new Error("Failed to reset");
      setLivePrefs(DEFAULT_BRIEFING_PREFS);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Reset to the defaults. Tell me what to keep, remove, or personalize next." },
      ]);
      toastSuccess("Briefing reset");
      onSaved();
    } catch {
      toastError("Failed to reset briefing");
    } finally {
      setSaving(false);
    }
  }, [onSaved, toastError, toastSuccess]);

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Tune Briefing"
      description="Chat with the AI and it will update your briefing preferences as you answer."
      maxWidth="max-w-2xl"
      align="top"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => void reset()} disabled={saving}>
            <RotateCcw size={11} aria-hidden /> Reset
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
              Saves after every reply
            </span>
            <button type="button" className="btn btn-primary text-xs" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      }
    >
      <div className="briefing-chat-shell">
        <SetupChips prefs={currentPrefs} />

        <div className="briefing-chat-starters" aria-label="Suggested replies">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              className="briefing-chat-starter"
              onClick={() => void submit(starter)}
              disabled={saving}
            >
              <Sparkles size={11} aria-hidden /> {starter}
            </button>
          ))}
        </div>

        <div className="briefing-chat-log" aria-live="polite">
          {messages.map((message, i) => (
            <ChatBubble key={`${message.role}-${i}`} message={message} />
          ))}
          {saving && <ChatBubble message={{ role: "assistant", content: "Thinking…" }} />}
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
            placeholder="e.g. I live near Belfast, have no kids, care about React, AI, F1 and gaming…"
            rows={3}
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(draft);
              }
            }}
          />
          <button type="submit" className="btn btn-primary briefing-chat-send" disabled={saving || !draft.trim()}>
            <Send size={13} aria-hidden /> Send
          </button>
        </form>
      </div>
    </ModalShell>
  );
}
