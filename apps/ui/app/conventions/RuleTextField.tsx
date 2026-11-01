"use client";

import { useId } from "react";
import { FieldError } from "@/components/ui/FieldError";

export function isRuleTextValid(text: string): boolean {
  return text.trim().length >= 8 && text.trim().length <= 240;
}

interface RuleTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}

export function RuleTextField({ value, onChange, label, placeholder }: RuleTextFieldProps) {
  const hintId = useId();
  const length = value.trim().length;
  const invalid = length > 0 && !isRuleTextValid(value);

  return (
    <div>
      <textarea
        className="input w-full text-sm"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        aria-describedby={hintId}
        aria-invalid={invalid}
        placeholder={placeholder}
        autoFocus
      />
      <div id={hintId} aria-live={invalid ? "polite" : "off"}>
        {invalid ? (
          <FieldError>Use 8–240 characters; this rule has {length}.</FieldError>
        ) : (
          <p className="text-xs text-text-muted mt-1">8–240 characters · {length} used</p>
        )}
      </div>
    </div>
  );
}
