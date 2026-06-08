"use client";

import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="card card-body flex flex-col items-center justify-center py-8">
      <span style={{ color: "var(--text-subtle)", marginBottom: "12px" }} aria-hidden>
        {icon}
      </span>
      <p className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{title}</p>
      {subtitle && (
        <p className="text-xs" style={{ color: "var(--text-subtle)" }}>{subtitle}</p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
