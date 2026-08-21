"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Paperclip, Play, RotateCw, Send, Square, X } from "lucide-react";
import { AgentUnavailableState } from "@/components/shell/AgentStatusStrip";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import {
  AgentChatError,
  AGENT_CHAT_CLEAR_EVENT,
  AGENT_COMPOSER_FOCUS_EVENT,
  AGENT_COMPOSER_INSERT_EVENT,
  clearAgentChatHistory,
  newAgentChatId,
  readAgentChatHistory,
  sendAgentChat,
  isUserAbortedAsk,
  writeAgentChatHistory,
  type AgentChatMessage,
} from "@/lib/agent-chat";
import {
  cliCannotUseImages,
  formatAttachSize,
  prepareAgentFiles,
  rejectAttachMessage,
  type AgentPreparedAttachment,
} from "@/lib/agent-attach";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import type { AgentUiPhase } from "@/lib/agent-status";
import { agentWorkflows, extractRunnableCommands } from "@/lib/terminal-prompt";
import {
  dataTransferHasTerminalSelection,
  readTerminalSelection,
  setTerminalSelectionDrag,
} from "@/lib/terminal-blocks";

export interface AgentChatSeed {
  prompt: string;
  display: string;
  autoSend: boolean;
  composerDraft?: boolean;
}

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.css,.html,.yml,.yaml,.toml,.sh,.svg,.csv";

export function AgentChatPanel({
  tabId,
  cwd,
  providerLabel,
  phase,
  seed,
  frame,
  onPhase,
  onSeedConsumed,
  onRequestDock,
  shellContext,
  onRunInTerminal,
  unavailableMessage,
}: {
  tabId: number;
  cwd?: string;
  providerLabel?: string;
  phase?: AgentUiPhase;
  seed?: AgentChatSeed;
  frame?: "dock" | "max" | "popout" | "min" | "split";
  onPhase: (phase: AgentUiPhase, summary?: string) => void;
  onSeedConsumed?: () => void;
  onRequestDock?: () => void;
  shellContext?: { cwd?: string; repoName?: string; lastBlock?: string };
  onRunInTerminal?: (command: string) => void;
  unavailableMessage?: string;
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => readAgentChatHistory(tabId));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState(false);
  const [attachments, setAttachments] = useState<AgentPreparedAttachment[]>([]);
  const [dragging, setDragging] = useState<"file" | "term" | false>(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sentSeedRef = useRef(false);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepthRef = useRef(0);

  const whom = providerLabel?.trim() || "the agent";
  const imageBlind = cliCannotUseImages(providerLabel);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    writeAgentChatHistory(tabId, messages);
  }, [tabId, messages]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    const onClear = (e: Event) => {
      const id = (e as CustomEvent<{ tabId?: number }>).detail?.tabId;
      if (id != null && id !== tabId) return;
      abortRef.current?.abort();
      clearAgentChatHistory(tabId);
      setMessages([]);
      setDraft("");
      setAttachments([]);
      setError(null);
      sentSeedRef.current = false;
      onPhase("ready");
    };
    const onInsert = (e: Event) => {
      const detail = (e as CustomEvent<{ tabId?: number; text?: string }>).detail;
      if (detail?.tabId != null && detail.tabId !== tabId) return;
      const text = detail?.text?.replace(/\s+$/, "") ?? "";
      if (!text) return;
      setDraft((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text));
      window.setTimeout(() => inputRef.current?.focus(), 40);
    };
    window.addEventListener(AGENT_COMPOSER_FOCUS_EVENT, onFocus);
    window.addEventListener(AGENT_CHAT_CLEAR_EVENT, onClear);
    window.addEventListener(AGENT_COMPOSER_INSERT_EVENT, onInsert);
    return () => {
      window.removeEventListener(AGENT_COMPOSER_FOCUS_EVENT, onFocus);
      window.removeEventListener(AGENT_CHAT_CLEAR_EVENT, onClear);
      window.removeEventListener(AGENT_COMPOSER_INSERT_EVENT, onInsert);
    };
  }, [onPhase, tabId]);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      const { ok, rejected } = await prepareAgentFiles(files, attachments.length);
      if (ok.length > 0) setAttachments((prev) => [...prev, ...ok]);
      for (const reject of rejected) toast.error(rejectAttachMessage(reject));
    },
    [attachments.length, toast],
  );

  const send = useCallback(
    async (display: string, prompt?: string, keepAttachments = false) => {
      const visible = display.trim();
      const payloadBase = (prompt ?? display).trim();
      if ((!visible && attachments.length === 0) || sending) return;
      if (!payloadBase && attachments.length === 0) return;

      const userMsg: AgentChatMessage = {
        id: newAgentChatId(),
        role: "user",
        content: visible || (attachments.length === 1 ? attachments[0]!.name : `${attachments.length} files`),
        payload: payloadBase || visible,
        createdAt: Date.now(),
        attachments: attachments.map((a) => ({ name: a.name, kind: a.kind })),
      };
      const attachPayload = attachments.map((a) => ({
        name: a.name,
        kind: a.kind,
        mime: a.mime,
        text: a.text,
        dataUrl: a.dataUrl,
      }));
      const assistantId = newAgentChatId();
      const history = [...messagesRef.current, userMsg];
      setMessages(history);
      writeAgentChatHistory(tabId, history);
      setDraft("");
      if (!keepAttachments) setAttachments([]);
      setSending(true);
      setError(null);
      onPhase("running");

      const turns = history
        .filter((m) => m.role !== "system")
        .map((m, i, arr) =>
          i === arr.length - 1 && m.role === "user"
            ? { role: "user" as const, content: m.payload || payloadBase || visible }
            : { role: m.role, content: m.content },
        );

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const result = await sendAgentChat(
          { messages: turns, cwd, attachments: attachPayload },
          (delta) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.id === assistantId && last.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
              }
              return [
                ...prev,
                { id: assistantId, role: "assistant", content: delta, createdAt: Date.now() },
              ];
            });
          },
          ac.signal,
        );
        if (!result.text) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === assistantId)) return prev;
            return [
              ...prev,
              {
                id: assistantId,
                role: "assistant",
                content: "(empty reply)",
                createdAt: Date.now(),
              },
            ];
          });
        }
        onPhase("ready");
      } catch (err) {
        if (isUserAbortedAsk(err, ac.signal)) {
          onPhase("ready");
          setMessages((prev) =>
            prev.some((m) => m.id === assistantId)
              ? prev
              : [
                  ...prev,
                  { id: assistantId, role: "assistant", content: "Stopped.", createdAt: Date.now() },
                ],
          );
          return;
        }
        const chatErr = err instanceof AgentChatError ? err : null;
        const message = err instanceof Error ? err.message : "Chat failed.";
        setError(message);
        setSetupHint(chatErr?.status === 503 || /not (installed|configured)/i.test(message));
        onPhase("failed", message);
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: message,
            createdAt: Date.now(),
          },
        ]);
      } finally {
        setSending(false);
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [attachments, cwd, onPhase, sending, tabId],
  );

  useEffect(() => {
    if (!seed) return;
    if (seed.autoSend) {
      if (sentSeedRef.current) return;
      if (readAgentChatHistory(tabId).length > 0) {
        sentSeedRef.current = true;
        onSeedConsumed?.();
        return;
      }
      sentSeedRef.current = true;
      const display = seed.display.trim() || seed.prompt.trim();
      if (!display) {
        onSeedConsumed?.();
        return;
      }
      void send(display, seed.prompt.trim() || display);
      onSeedConsumed?.();
      return;
    }
    const draftText = (seed.display || seed.prompt).trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding the composer from a one-shot prop
    if (draftText) setDraft(draftText);
    onSeedConsumed?.();
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [seed, send, tabId, onSeedConsumed]);

  const retryLast = useCallback(() => {
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser || sending) return;
    setMessages((prev) => {
      const next = [...prev];
      if (next[next.length - 1]?.role === "assistant") next.pop();
      return next;
    });
    void send(lastUser.content, lastUser.payload || lastUser.content);
  }, [send, sending]);

  if (phase === "failed" && messages.length === 0) {
    return (
      <AgentUnavailableState
        message={error || unavailableMessage || "This agent isn’t available."}
        onSetup={() =>
          window.dispatchEvent(new CustomEvent("devhub:navigate", { detail: { href: "/setup" } }))
        }
      />
    );
  }

  const last = messages[messages.length - 1];
  const canSend = !sending && (Boolean(draft.trim()) || attachments.length > 0);
  const workflows = agentWorkflows({
    cwd: shellContext?.cwd ?? cwd,
    repoName: shellContext?.repoName,
    lastBlock: shellContext?.lastBlock,
  });
  const contextChips = [
    (shellContext?.repoName || cwd?.split("/").filter(Boolean).pop()) && {
      id: "repo",
      label: shellContext?.repoName || cwd?.split("/").filter(Boolean).pop() || "",
    },
    attachments.length > 0 && { id: "files", label: `${attachments.length} file${attachments.length === 1 ? "" : "s"}` },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div
      className="agent-chat"
      data-frame={frame}
      onDragEnter={(e) => {
        const files = [...e.dataTransfer.types].includes("Files");
        const term = dataTransferHasTerminalSelection(e.dataTransfer);
        if (!files && !term) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDragging(files ? "file" : "term");
      }}
      onDragOver={(e) => {
        const files = [...e.dataTransfer.types].includes("Files");
        const term = dataTransferHasTerminalSelection(e.dataTransfer);
        if (!files && !term) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        setTerminalSelectionDrag(false);
        if (e.dataTransfer.files.length > 0) {
          void addFiles(e.dataTransfer.files);
          return;
        }
        const text = readTerminalSelection(e.dataTransfer);
        if (!text) return;
        setDraft((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text));
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }}
    >
      {dragging ? (
        <div className="agent-chat-drop" aria-hidden>
          {dragging === "term" ? "Drop to ask" : "Drop to attach"}
        </div>
      ) : null}
      <div className="agent-chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && !sending ? (
          <p className="agent-chat-empty">
            Ask about this repo. Drop a file or selected terminal output here.
          </p>
        ) : null}
        {messages
          .filter((m) => m.role !== "system")
          .map((message, i, arr) => {
            const isLast = i === arr.length - 1;
            return (
              <div
                key={message.id}
                className={`agent-chat-row ${message.role === "user" ? "is-user" : "is-ai"}`}
              >
                <div className="agent-chat-bubble">
                  {message.role === "assistant" ? (
                    <SimpleMarkdown text={message.content} compact className="agent-chat-md" />
                  ) : (
                    message.content
                  )}
                  {message.attachments && message.attachments.length > 0 ? (
                    <ul className="agent-chat-chips">
                      {message.attachments.map((att) => (
                        <li key={att.name}>{att.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {message.role === "assistant" ? (
                  <div className="agent-chat-msg-actions">
                    <button
                      type="button"
                      className="agent-chat-msg-btn"
                      onClick={() => void copyTextToClipboard(message.content)}
                    >
                      <Copy size={11} aria-hidden /> Copy
                    </button>
                    {isLast && !sending ? (
                      <button type="button" className="agent-chat-msg-btn" onClick={retryLast}>
                        <RotateCw size={11} aria-hidden /> Retry
                      </button>
                    ) : null}
                    {onRunInTerminal
                      ? extractRunnableCommands(message.content).map((cmd) => (
                          <button
                            key={cmd.slice(0, 48)}
                            type="button"
                            className="agent-chat-msg-btn"
                            onClick={() => onRunInTerminal(cmd)}
                          >
                            <Play size={11} aria-hidden /> Run
                          </button>
                        ))
                      : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        {sending && last?.role !== "assistant" ? (
          <div className="agent-chat-row is-ai">
            <div className="agent-chat-bubble agent-chat-pending" aria-label="Waiting for reply">
              <span className="agent-chat-shimmer" />
            </div>
          </div>
        ) : null}
      </div>
      {setupHint ? (
        <div className="agent-chat-setup">
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("devhub:navigate", { detail: { href: "/setup" } }))
            }
          >
            Setup
          </button>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="agent-chat-attach-list">
          {attachments.map((att) => (
            <li key={att.id} className="agent-chat-attach-chip">
              {att.kind === "image" && att.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={att.dataUrl} alt="" className="agent-chat-thumb" />
              ) : null}
              <span>
                {att.name}{" "}
                <em>{formatAttachSize(att.size)}</em>
              </span>
              {att.kind === "image" && imageBlind ? (
                <span className="agent-chat-attach-note">CLI may skip images</span>
              ) : null}
              <button
                type="button"
                className="agent-chat-attach-remove"
                aria-label={`Remove ${att.name}`}
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
              >
                <X size={10} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {contextChips.length > 0 ? (
        <ul className="agent-chat-context">
          {contextChips.map((chip) => (
            <li key={chip.id}>{chip.label}</li>
          ))}
        </ul>
      ) : null}
      {messages.length === 0 && !sending ? (
        <div className="agent-chat-workflows">
          {workflows.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="agent-chat-workflow"
              onClick={() => {
                setDraft(chip.draft);
                inputRef.current?.focus();
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="agent-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn btn-ghost agent-chat-attach-btn"
          aria-label="Attach files"
          title="Attach"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={13} aria-hidden />
        </button>
        <textarea
          ref={inputRef}
          className="input agent-chat-input"
          value={draft}
          rows={2}
          disabled={sending}
          placeholder={cwd ? "Ask about this repo" : `Ask ${whom}`}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (files && files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              inputRef.current?.blur();
              if (frame === "popout") onRequestDock?.();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        {sending ? (
          <button
            type="button"
            className="btn btn-ghost agent-chat-send"
            aria-label="Stop"
            onClick={() => abortRef.current?.abort()}
          >
            <Square size={12} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary agent-chat-send"
            disabled={!canSend}
            aria-label="Send"
          >
            <Send size={13} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
