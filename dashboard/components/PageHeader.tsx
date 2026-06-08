import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        <div className="page-title">{title}</div>
        {subtitle ? (
          <div className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>{subtitle}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge}
        {actions}
      </div>
    </div>
  );
}
