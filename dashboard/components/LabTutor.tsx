"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { LabMarkdown } from "@/components/LabMarkdown";
import { REPO_LEARN_TUTOR_START } from "@/lib/repo-learn-constants";

/** One-tap moves for the common turns — the lab loop is do → paste → verify. */
const QUICK_REPLIES = ["Check my work", "Give me a hint", "How does this apply beyond this repo?"];

function messageText(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

/**
 * Live, resumable Socratic session for a lab: an adaptive tutor scoped to one
 * signal in one repo that holds your hand through the lab and checks your work.
 * The transcript is persisted per lab (via /api/capability/journey/session), so
 * you can come and go — reopening the lab restores where you left off.
 */
export function LabTutor({
  repoName,
  repoPath,
  signalId,
  category,
  aiConfigured,
}: {
  repoName: string;
  /** Local clone path — makes file mentions in tutor replies clickable. */
  repoPath?: string | null;
  signalId: string;
  category: string;
  aiConfigured: boolean;
}) {
  const [input, setInput] = useState("");
  const [started, setStarted] = useState(false);
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<string>("");

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/capability/journey/tutor",
      body: { repoName, signalId },
    }),
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Hands on keyboard: focus the answer box when the session starts and again
  // whenever the tutor finishes a reply.
  useEffect(() => {
    if (started && !isStreaming) inputRef.current?.focus();
  }, [started, isStreaming]);

  // Restore a saved transcript on mount (come-and-go).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/capability/journey/session?category=${encodeURIComponent(category)}`);
        const body = (await res.json()) as { messages?: UIMessage[] };
        if (!cancelled && body.messages && body.messages.length > 0) {
          setMessages(body.messages);
          savedRef.current = JSON.stringify(body.messages);
          setStarted(true);
        }
      } catch {
        // no saved session — fine
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, setMessages]);

  // Persist the transcript after each completed turn.
  useEffect(() => {
    if (!started || isStreaming || messages.length === 0) return;
    const serialized = JSON.stringify(messages);
    if (serialized === savedRef.current) return;
    savedRef.current = serialized;
    void fetch("/api/capability/journey/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, messages }),
    }).catch(() => {});
  }, [messages, isStreaming, started, category]);

  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    void sendMessage({ text: REPO_LEARN_TUTOR_START });
  }, [started, sendMessage]);

  const reset = useCallback(() => {
    setMessages([]);
    savedRef.current = "";
    setStarted(false);
    void fetch("/api/capability/journey/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, clear: true }),
    }).catch(() => {});
  }, [setMessages, category]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    void sendMessage({ text });
  }, [input, isStreaming, sendMessage]);

  if (!aiConfigured) {
    return (
      <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
        Set <code>AI_API_KEY</code> to run the live session.
      </p>
    );
  }

  if (!started) {
    return (
      <button
        type="button"
        className="btn btn-ghost text-xs"
        style={{ padding: "4px 8px" }}
        onClick={start}
        disabled={!restored}
      >
        <Sparkles size={12} /> Start live session
      </button>
    );
  }

  const visible = messages.filter((m) => !(m.role === "user" && messageText(m.parts) === REPO_LEARN_TUTOR_START));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>
        <Sparkles size={11} /> Live session
        <span className="ml-auto normal-case">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px", fontSize: 11 }}
            onClick={reset}
            disabled={isStreaming}
          >
            <RotateCcw size={11} /> Reset
          </button>
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex flex-col gap-2 overflow-y-auto"
        style={{ maxHeight: 280, paddingRight: 4 }}
      >
        {visible.map((m) => (
          <div
            key={m.id}
            className="lab-msg-enter text-xs rounded"
            style={{
              padding: "8px 10px",
              background: m.role === "user" ? "var(--bg-muted)" : "var(--accent-dim)",
              color: "var(--text)",
            }}
          >
            <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-subtle)" }}>
              {m.role === "user" ? "You" : "Tutor"}
            </div>
            <LabMarkdown text={messageText(m.parts)} fileBase={repoPath ?? undefined} />
          </div>
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-subtle)" }}>
            <Loader2 size={12} className="animate-spin" /> thinking…
          </div>
        )}
      </div>
      {error && (
        <p className="text-[11px]" style={{ color: "var(--danger)" }}>
          {error.message || "Tutor error."}
        </p>
      )}
      {!isStreaming && visible.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              className="btn btn-ghost"
              style={{ padding: "1px 7px", fontSize: 10, color: "var(--text-subtle)" }}
              onClick={() => void sendMessage({ text: q })}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type your answer…"
          disabled={isStreaming}
          className="input text-xs flex-1"
        />
        <button
          type="button"
          className="btn btn-ghost text-xs shrink-0"
          style={{ padding: "5px 8px" }}
          onClick={submit}
          disabled={isStreaming || !input.trim()}
          aria-label="Send answer"
        >
          <Send size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
