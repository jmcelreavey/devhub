"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  input?: {
    placeholder?: string;
    defaultValue?: string;
    /** Optional AI / helper action that fills the prompt input. */
    generateAi?: {
      label?: string;
      onGenerate: () => Promise<string>;
    };
  };
}

type PendingConfirm =
  | (ConfirmOptions & { kind: "confirm"; resolve: (ok: boolean) => void })
  | (ConfirmOptions & { kind: "prompt"; resolve: (value: string | null) => void });

interface ConfirmContextValue {
  request: (opts: ConfirmOptions) => Promise<boolean>;
  requestString: (opts: ConfirmOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const request = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, kind: "confirm", resolve });
    });
  }, []);

  const requestString = useCallback((opts: ConfirmOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPending({ ...opts, kind: "prompt", resolve });
    });
  }, []);

  const closeConfirm = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      if (pending.kind === "confirm") {
        pending.resolve(ok);
      }
      setPending(null);
    },
    [pending],
  );

  const closePrompt = useCallback(
    (value: string | null) => {
      if (!pending || pending.kind !== "prompt") return;
      pending.resolve(value);
      setPending(null);
    },
    [pending],
  );

  const value = useMemo(() => ({ request, requestString }), [request, requestString]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialogView
          pending={pending}
          onConfirm={closeConfirm}
          onPrompt={closePrompt}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialogView({
  pending,
  onConfirm,
  onPrompt,
}: {
  pending: PendingConfirm;
  onConfirm: (ok: boolean) => void;
  onPrompt: (value: string | null) => void;
}) {
  const titleId = "confirm-dialog-title";
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [inputValue, setInputValue] = useState(pending.input?.defaultValue ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const generateAi = pending.kind === "prompt" ? pending.input?.generateAi : undefined;

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    if (pending.kind === "prompt") {
      inputRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pending.kind === "prompt") {
          onPrompt(null);
        } else {
          onConfirm(false);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [pending, onConfirm, onPrompt]);

  function handleConfirm() {
    if (pending.kind === "prompt") {
      onPrompt(inputValue);
    } else {
      onConfirm(true);
    }
  }

  async function handleGenerateAi() {
    if (!generateAi || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const next = await generateAi.onGenerate();
      setInputValue(next);
      inputRef.current?.focus();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI draft failed");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (pending.kind === "prompt") {
            onPrompt(null);
          } else {
            onConfirm(false);
          }
        }
      }}
    >
      <div
        className="card modal-panel"
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 20,
          background: "var(--bg-surface)",
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          {pending.title}
        </h2>
        {pending.message && (
          <p style={{ margin: "8px 0 16px", color: "var(--text-muted)", fontSize: 13 }}>
            {pending.message}
          </p>
        )}
        {pending.kind === "prompt" && (
          <>
            <input
              ref={inputRef}
              className="input"
              placeholder={pending.input?.placeholder ?? ""}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !aiBusy) handleConfirm();
              }}
              style={{ marginBottom: generateAi || aiError ? 8 : 16, fontSize: 13 }}
              disabled={aiBusy}
            />
            {generateAi && (
              <div style={{ display: "flex", marginBottom: aiError ? 8 : 16 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11 }}
                  disabled={aiBusy}
                  onClick={() => void handleGenerateAi()}
                >
                  {aiBusy ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {generateAi.label ?? "AI message"}
                </button>
              </div>
            )}
            {aiError && (
              <p style={{ margin: "0 0 16px", color: "var(--danger)", fontSize: 12 }}>{aiError}</p>
            )}
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={aiBusy}
            onClick={() => {
              if (pending.kind === "prompt") {
                onPrompt(null);
              } else {
                onConfirm(false);
              }
            }}
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={pending.variant === "danger" ? "btn btn-danger-ghost" : "btn btn-primary"}
            disabled={aiBusy}
            onClick={handleConfirm}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts: Omit<ConfirmOptions, "input">): Promise<boolean> => {
      if (!ctx) {
        // Safe fallback if provider isn't mounted (e.g. in tests)
        return Promise.resolve(window.confirm(opts.message ?? opts.title));
      }
      return ctx.request(opts);
    },
    [ctx],
  );
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts: ConfirmOptions): Promise<string | null> => {
      if (!ctx) {
        // Safe fallback if provider isn't mounted (e.g. in tests)
        const value = window.prompt(opts.message ?? opts.title, opts.input?.defaultValue ?? "");
        return Promise.resolve(value);
      }
      return ctx.requestString(opts);
    },
    [ctx],
  );
}
