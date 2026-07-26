"use client";

import { Check, AlertTriangle, Minus, ExternalLink } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { CopyButton } from "@/components/ui/CopyButton";
import { LoadingLine } from "@/components/ui/LoadingLine";
import type { DependencyReport } from "@/lib/setup/dependencies";

/**
 * What's installed on this machine, and what each missing tool would unlock.
 *
 * The framing is deliberate. An earlier instinct was to list everything missing
 * in red, but a new user with a clean machine would then see six red rows and
 * conclude the app is broken - when in fact only two tools actually matter.
 * So: required-and-missing is a warning, optional-and-missing is a neutral
 * "not set up yet" with the feature it would unlock spelled out.
 *
 * Nobody should have to guess why DevHub wants Docker.
 */
export function DependencyChecklist() {
  const { data, error, isLoading } = useLive<DependencyReport>("/api/setup/dependencies", {
    refreshInterval: 0,
  });

  if (isLoading) return <LoadingLine />;
  if (error || !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
        Could not check installed tools.
      </p>
    );
  }

  const required = data.tools.filter((t) => t.required);
  const optional = data.tools.filter((t) => !t.required);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {data.availableCount} of {data.totalCount} tools available.
        {data.ready
          ? " Everything DevHub needs is installed."
          : ` DevHub needs ${data.missingRequired.join(" and ")} to work.`}
      </p>

      <Group title="Needed" tools={required} />
      <Group title="Optional - each one turns on a feature" tools={optional} />
    </div>
  );
}

function Group({ title, tools }: { title: string; tools: DependencyReport["tools"] }) {
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold" style={{ color: "var(--text-subtle)" }}>
        {title}
      </div>
      <ul className="flex flex-col">
        {tools.map((t) => (
          <li
            key={t.id}
            className="flex items-start gap-2.5 rounded px-2 py-2"
            style={{ borderBottom: "1px solid var(--border-muted)" }}
          >
            <span className="mt-0.5 shrink-0">
              {t.present ? (
                <Check size={14} className="text-success" aria-label="Installed" />
              ) : t.required ? (
                <AlertTriangle size={14} className="text-danger" aria-label="Missing - required" />
              ) : (
                <Minus size={14} style={{ color: "var(--text-subtle)" }} aria-label="Not installed" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span style={{ color: "var(--text)" }}>{t.label}</span>
                {t.version && (
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-subtle)" }}>
                    {t.version}
                  </span>
                )}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t.unlocks}
              </div>

              {/* Install help only when it's actually needed. */}
              {!t.present && (t.installCommand || t.installUrl) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {t.installCommand && (
                    <>
                      <code
                        className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                      >
                        {t.installCommand}
                      </code>
                      <CopyButton text={t.installCommand} label="Copy" />
                    </>
                  )}
                  {t.installUrl && (
                    <a
                      href={t.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-accent"
                    >
                      Download <ExternalLink size={10} aria-hidden />
                    </a>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
