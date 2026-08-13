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

/**
 * Each request carries an `id`.
 *
 * The dialog seeds its input from `defaultValue` with `useState`, which only
 * reads on mount. Two prompts in a row — "name?" then "URL?" — set `pending`
 * to null and straight back again, and React reconciles that as the same
 * component rather than a remount, so the second prompt opened still holding
 * the first one's answer and typing appended to it. Keying on the id makes each
 * request a distinct instance, which is what it always was conceptually.
 */
type PendingConfirm = { id: number } & (
  | (ConfirmOptions & { kind: "confirm"; resolve: (ok: boolean) => void })
  | (ConfirmOptions & { kind: "prompt"; resolve: (value: string | null) => void })
);

let nextPendingId = 0;

interface ConfirmContextValue {
  request: (opts: ConfirmOptions) => Promise<boolean>;
  requestString: (opts: ConfirmOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const request = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, id: (nextPendingId += 1), kind: "confirm", resolve });
    });
  }, []);

  const requestString = useCallback((opts: ConfirmOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPending({ ...opts, id: (nextPendingId += 1), kind: "prompt", resolve });
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
          key={pending.id}
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [inputValue, setInputValue] = useState(pending.input?.defaultValue ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const generateAi = pending.kind === "prompt" ? pending.input?.generateAi : undefined;

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal !== "function") {
        if (pending.kind === "prompt") onPrompt(null);
        else onConfirm(false);
        return;
      }
      dialog.showModal();
    }
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
      if (dialog?.open) dialog.close();
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
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (pending.kind === "prompt") onPrompt(null);
        else onConfirm(false);
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
    </dialog>
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
