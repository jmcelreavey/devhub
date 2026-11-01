"use client";

import { useId, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  secret,
  onToggleSecret,
  hint,
  onFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
  onToggleSecret?: () => void;
  hint?: ReactNode;
  onFocus?: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          aria-describedby={hint ? hintId : undefined}
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete={secret ? "new-password" : "off"}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            width: "100%",
            padding: onToggleSecret ? "8px 36px 8px 12px" : "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text)",
            fontSize: "13px",
            boxSizing: "border-box",
            fontFamily: "monospace",
          }}
          onFocus={() => onFocus?.()}
        />
        {onToggleSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            aria-label={secret ? `Show ${label}` : `Hide ${label}`}
            aria-pressed={!secret}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-subtle)",
              padding: "2px",
            }}
          >
            {secret ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-snug text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
