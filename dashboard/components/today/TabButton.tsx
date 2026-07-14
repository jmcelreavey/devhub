"use client";

import type { ReactNode } from "react";

export function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="hub-tab"
      data-active={active}
    >
      {icon}
      {label}
    </button>
  );
}
