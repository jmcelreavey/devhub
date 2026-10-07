"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { CATEGORY_LABEL, RULE_CATEGORIES, type RuleCategory } from "@/lib/conventions/types";
import type { RuleAction, RuleView } from "./api";
import { isRuleTextValid, RuleTextField } from "./RuleTextField";

function statusBadge(rule: RuleView): { label: string; className: string } {
  if (rule.automaticDecision) {
    return { label: rule.status === "accepted" ? "Automatically accepted" : "Automatically rejected", className: rule.status === "accepted" ? "badge badge-success" : "badge badge-muted" };
  }
  if (rule.status === "accepted" && rule.acceptedBy === "pr") {
    return { label: "Auto-accepted · author agreement", className: "badge badge-success" };
  }
  if (rule.status === "accepted") return { label: "Active", className: "badge badge-success" };
  if (rule.status === "rejected") return { label: "Rejected", className: "badge badge-muted" };
  return { label: "Awaiting automatic assessment", className: "badge badge-muted" };
}

function originNote(rule: RuleView): string | null {
  if (rule.origin === "manual") return "Added by you";
  if (rule.origin === "guidance") return "From the repo's guidance docs";
  return null;
}

export function RuleCard({
  rule,
  busy,
  onAction,
}: {
  rule: RuleView;
  busy: boolean;
  onAction: (action: RuleAction) => Promise<boolean>;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const [why, setWhy] = useState(rule.why ?? "");
  const [scope, setScope] = useState(rule.scope ?? "");
  const [category, setCategory] = useState<RuleCategory>(rule.category);

  const restoreEditFocus = useRef(false);
  const closeEditor = (): void => {
    restoreEditFocus.current = true;
    setEditing(false);
  };

  const badge = statusBadge(rule);
  const origin = originNote(rule);
  const prCount = rule.prs.length;

  const save = async (): Promise<void> => {
    const saved = await onAction({ action: "edit", ruleId: rule.id, text, why, scope, category });
    if (saved) closeEditor();
  };

  return (
    <article className="card card-body" aria-label={rule.text}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="badge badge-muted">{CATEGORY_LABEL[rule.category]}</span>
        <span className={badge.className}>{badge.label}</span>
        {origin ? <span className="text-xs text-text-muted">{origin}</span> : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <RuleTextField value={text} onChange={setText} label="Rule text" />
          <input
            className="input w-full text-xs"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Why (optional)"
            aria-label="Why"
          />
          <div className="flex flex-wrap gap-2">
            <input
              className="input text-xs font-mono flex-1 min-w-[10rem]"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Scope, e.g. src/services/** (optional)"
              aria-label="Scope"
            />
            <select
              className="input text-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value as RuleCategory)}
              aria-label="Category"
            >
              {RULE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary text-xs" disabled={busy || !isRuleTextValid(text)} onClick={() => void save()}>
              Save and accept
            </button>
            <button type="button" className="btn btn-ghost text-xs" onClick={closeEditor}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-text leading-snug">{rule.text}</p>
          {rule.why ? <p className="text-xs text-text-muted mt-1">{rule.why}</p> : null}
          {rule.automaticDecision ? <p className="text-xs text-text-muted mt-1">Decision: {rule.automaticDecision.reason}</p> : null}
          {rule.scope ? (
            <p className="mt-1.5">
              <code className="text-xs text-text-muted">{rule.scope}</code>
            </p>
          ) : null}
        </>
      )}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
          <span className="text-xs text-text-muted">
            {prCount > 0 ? `${prCount} PR${prCount === 1 ? "" : "s"} · ` : ""}
            seen {formatRelative(Date.parse(rule.lastSeen))}
          </span>
          {rule.evidence.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost text-xs min-h-11 sm:min-h-8 inline-flex items-center gap-1"
              aria-expanded={showEvidence}
              onClick={() => setShowEvidence((v) => !v)}
            >
              {showEvidence ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Evidence ({rule.evidence.length})
            </button>
          ) : null}

          <span className="ml-auto flex flex-wrap items-center gap-1">
            {rule.status === "rejected" ? (
              <button
                type="button"
                className="btn btn-ghost text-xs min-h-11 sm:min-h-8"
                disabled={busy}
                onClick={() => void onAction({ action: "status", ruleId: rule.id, status: "accepted" })}
              >
                <RotateCcw size={12} /> Reinstate
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost text-xs min-h-11 sm:min-h-8"
                disabled={busy}
                onClick={() => void onAction({ action: "status", ruleId: rule.id, status: "rejected" })}
              >
                <X size={12} /> Remove
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost text-xs min-h-11 sm:min-h-8"
              disabled={busy}
              ref={(node) => {
                if (node && restoreEditFocus.current) {
                  node.focus();
                  restoreEditFocus.current = false;
                }
              }}
              onClick={() => {
                setText(rule.text);
                setWhy(rule.why ?? "");
                setScope(rule.scope ?? "");
                setCategory(rule.category);
                setEditing(true);
              }}
            >
              <Pencil size={12} /> Edit
            </button>
            {rule.origin === "manual" ? (
              <button
                type="button"
                className="btn btn-danger-ghost text-xs min-h-11 sm:min-h-8"
                disabled={busy}
                onClick={() => void onAction({ action: "delete", ruleId: rule.id })}
              >
                <Trash2 size={12} /> Delete
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {showEvidence && !editing ? (
        <ul className="mt-3 space-y-2">
          {rule.evidence.map((item) => (
            <li key={`${item.kind}:${item.url ?? item.label}`} className="border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 sm:min-h-8 items-center gap-1 underline underline-offset-2 hover:text-accent"
                  >
                    {item.label} <ExternalLink size={10} aria-hidden />
                  </a>
                ) : (
                  <span>{item.label}</span>
                )}
                {item.path ? <code className="text-[10.5px]">{item.path}</code> : null}
                {item.at ? <span>{formatRelative(Date.parse(item.at))}</span> : null}
                {item.actedOn ? <span className="text-text-muted" title="The thread is outdated and the author resolved it or explicitly confirmed a change. This does not verify the resulting diff.">Author resolved or confirmed the request</span> : null}
              </div>
              {item.kind === "review" ? <p className="text-xs text-text-muted mt-0.5 whitespace-pre-wrap">{item.quote}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
