"use client";

import { Eye, EyeOff } from "lucide-react";

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  secret,
  onToggleSecret,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
  onToggleSecret?: () => void;
  hint?: string;
}) {
  return (
    <div>
      <label
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
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            width: "100%",
            padding: onToggleSecret ? "8px 36px 8px 12px" : "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text)",
            fontSize: "13px",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "monospace",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />
        {onToggleSecret && (
          <button
            onClick={onToggleSecret}
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
            {secret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
