"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BookOpen, Loader2, Send } from "lucide-react";
import { textToBlocks } from "@/lib/markdown-convert";
import {
  gapExplanationForLearning,
  hasGapExplanation,
  stripGapMarker,
} from "@/lib/repo-learn-tutor-utils";
import { REPO_LEARN_TUTOR_START, repoLearnApiPath } from "@/lib/repo-learn-constants";
import { slugify } from "@/lib/slugify";
import { useToast } from "@/lib/use-toast";

interface RepoLearnTutorProps {
  repoName: string;
  aiConfigured: boolean;
}

function messageText(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

export function RepoLearnTutor({ repoName, aiConfigured }: RepoLearnTutorProps) {
  const toast = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const api = repoLearnApiPath(repoName, "/tutor");

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api }),
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const lastMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    if (!aiConfigured || startedRef.current) return;
    startedRef.current = true;
    void sendMessage({ text: REPO_LEARN_TUTOR_START });
  }, [aiConfigured, sendMessage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  const submitAnswer = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    void sendMessage({ text });
  }, [input, isStreaming, sendMessage]);

  const saveGap = useCallback(
    async (messageId: string, rawText: string) => {
      setSavingId(messageId);
      try {
        const markdown = gapExplanationForLearning(repoName, rawText);
        const slug = slugify(markdown.split("\n")[0] ?? "gap", { fallback: "gap" });
        const fullPath = `inbox/${repoName}-${slug}`;
        const res = await fetch(`/api/notes/learnings/${fullPath}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: textToBlocks(markdown) }),
        });
        if (!res.ok) throw new Error("Could not save learning.");
        toast.success(`Saved to learnings/${fullPath}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed.");
      } finally {
        setSavingId(null);
      }
    },
    [repoName, toast],
  );

  if (!aiConfigured) {
    return (
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
        Configure z.ai to use the Socratic tutor.{" "}
        <Link href="/setup" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>
          Open Setup
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto space-y-2 rounded border p-2"
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
      >
        {messages.length === 0 && isStreaming && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-subtle)" }}>
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Starting tutor…
          </div>
        )}
        {messages.map((message) => {
          const parts = message.parts as { type: string; text?: string }[];
          const rawText = messageText(parts);
          if (message.role === "user" && rawText === REPO_LEARN_TUTOR_START) return null;

          const displayText = message.role === "assistant" ? stripGapMarker(rawText) : rawText;
          const showSave = message.role === "assistant" && hasGapExplanation(rawText);
          const isStreamingThis = status === "streaming" && message.role === "assistant" && message.id === lastMessageId;

          return (
            <div
              key={message.id}
              className="rounded p-2 text-xs leading-relaxed"
              style={{
                background: message.role === "user" ? "var(--bg-surface)" : "transparent",
                color: message.role === "user" ? "var(--text)" : "var(--text-subtle)",
              }}
            >
              <div className="mb-0.5 text-[10px] uppercase tracking-wide font-medium" style={{ color: "var(--text-subtle)" }}>
                {message.role === "user" ? "You" : "Tutor"}
              </div>
              <div className="whitespace-pre-wrap">
                {displayText}
                {isStreamingThis && <StreamCursor />}
              </div>
              {showSave && !isStreamingThis && (
                <button
                  type="button"
                  className="btn btn-ghost mt-2"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  disabled={savingId === message.id}
                  onClick={() => void saveGap(message.id, rawText)}
                >
                  <BookOpen size={11} aria-hidden />
                  {savingId === message.id ? "Saving…" : "Save to learnings"}
                </button>
              )}
            </div>
          );
        })}
        {error && (
          <p className="text-xs" style={{ color: "var(--danger)" }}>
            {error.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitAnswer();
            }
          }}
          placeholder="Your answer…"
          disabled={isStreaming}
          className="input flex-1 text-xs"
          style={{ padding: "6px 10px" }}
          aria-label="Answer the tutor"
        />
        <button
          type="button"
          className="btn btn-primary shrink-0"
          style={{ fontSize: 12, padding: "4px 10px" }}
          disabled={isStreaming || !input.trim()}
          onClick={submitAnswer}
          aria-label="Send answer"
        >
          {isStreaming ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </div>
    </div>
  );
}

function StreamCursor() {
  return (
    <span
      className="inline-block w-1.5 h-3.5 ml-0.5 align-text-bottom rounded-sm animate-pulse"
      style={{ background: "var(--accent)" }}
      aria-hidden
    />
  );
}
