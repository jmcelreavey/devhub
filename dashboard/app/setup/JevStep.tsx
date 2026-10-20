"use client";

import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { FieldError } from "@/components/ui/FieldError";
import { TYPESAFE_KEYS_URL } from "@/lib/qa/typesafe-key";
import { FormField } from "./FormField";
import { SECRET_FIELD_MASK } from "./shared";

export type TypesafeKeySource = "setup" | "env" | "repo-env" | null;

const SOURCE_LABEL: Record<Exclude<TypesafeKeySource, null>, string> = {
  setup: "Jev key saved",
  env: "Using TYPESAFE_API_KEY from the server environment",
  "repo-env": "Using TYPESAFE_API_KEY from the repo's .env file",
};

/** Setup → QA (Jev): one masked key, a Test button, and whether QA runs can use it. */
export function JevStep({
  apiKey,
  onApiKeyChange,
  showSecret,
  onToggleSecret,
  source,
  checking,
  onTest,
  error,
  checkOk,
}: {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  source: TypesafeKeySource;
  checking: boolean;
  onTest: () => void;
  error: string;
  checkOk?: string;
}) {
  const configured = source !== null;
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>QA (Jev)</h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "20px", lineHeight: 1.5 }}>
        QA runs use Jev to pick each next step. Create a key in the{" "}
        <a href={TYPESAFE_KEYS_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text, var(--accent))", textDecoration: "underline" }}>
          TypeSafe console
          <ExternalLink size={10} aria-hidden style={{ display: "inline", marginLeft: "2px", verticalAlign: "middle" }} />
        </a>{" "}
        and paste it here.
      </p>

      <FormField
        label={configured ? "Replace API key" : "TypeSafe API key"}
        value={apiKey}
        onChange={onApiKeyChange}
        placeholder={configured ? "Paste a new key to replace" : "apikey_…"}
        secret={!showSecret}
        onToggleSecret={onToggleSecret}
        onFocus={() => { if (apiKey === SECRET_FIELD_MASK) onApiKeyChange(""); }}
        hint={configured ? "Leave blank to keep the current key. Saved on this machine only, never in the repo." : "Saved on this machine only, never in the repo."}
      />

      <div
        role="status"
        style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderRadius: "8px", marginTop: "16px",
          background: configured ? "var(--accent-dim)" : "var(--bg-elevated)", border: "1px solid var(--border)",
        }}
      >
        {configured ? <CheckCircle2 size={18} className="text-accent" aria-hidden /> : <Circle size={18} aria-hidden />}
        <span style={{ fontSize: "13px", fontWeight: 500, color: configured ? "var(--accent-text, var(--accent))" : "var(--text-subtle)" }}>
          {source ? SOURCE_LABEL[source] : "Not configured. QA runs need a key."}
        </span>
      </div>

      <button type="button" onClick={onTest} disabled={checking} className="btn btn-ghost mt-3.5">
        {checking ? "Testing…" : "Test"}
      </button>
      {checkOk && <p className="mt-2 text-[12px] leading-snug" style={{ color: "var(--accent-text, var(--accent))" }}>{checkOk}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
