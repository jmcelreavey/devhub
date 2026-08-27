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
        <h1 className="page-title">{title}</h1>
        {subtitle ? (
          <div className="text-xs mt-1 text-text-subtle">{subtitle}</div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {badge}
        {actions}
      </div>
    </div>
  );
}
