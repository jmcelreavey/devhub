"use client";

import type { ReactNode } from "react";
import { LaunchMenu, type LaunchMenuItem } from "@/components/shell/LaunchMenu";

export function SplitLaunchButton({
  label,
  icon,
  onPrimary,
  items,
  primaryClassName = "btn btn-ghost text-xs",
  primaryTitle,
}: {
  label: string;
  icon: ReactNode;
  onPrimary: () => void;
  items: LaunchMenuItem[];
  primaryClassName?: string;
  primaryTitle?: string;
}) {
  return (
    <div className="repo-git-commit-split relative inline-flex">
      <button type="button" className={primaryClassName} title={primaryTitle} onClick={onPrimary}>
        {icon}
        {label}
      </button>
      <LaunchMenu
        label={`${label} options`}
        hideLabel
        items={items}
        align="left"
        buttonClassName={`${primaryClassName} repo-git-commit-caret`}
      />
    </div>
  );
}
