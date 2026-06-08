"use client";

import { useMemo } from "react";
import { IconGridPopover, iconGridOptionsFromIds } from "@/components/IconGridPopover";
import {
  CHECKLIST_ICON_NAMES,
  ChecklistIcon,
  type ChecklistIconName,
} from "@/lib/checklists/icons";

export function ChecklistIconPicker({
  value = "list",
  onChange,
  fieldLabel,
  inline,
  triggerIconSize,
  triggerClassName,
  triggerAriaLabel = "Change checklist icon",
}: {
  value?: ChecklistIconName;
  onChange: (icon: ChecklistIconName) => void;
  fieldLabel?: string;
  inline?: boolean;
  triggerIconSize?: number;
  triggerClassName?: string;
  triggerAriaLabel?: string;
}) {
  const options = useMemo(
    () =>
      iconGridOptionsFromIds(CHECKLIST_ICON_NAMES, (id, size) => (
        <ChecklistIcon name={id} size={size} />
      )),
    [],
  );

  return (
    <IconGridPopover
      value={value}
      onChange={onChange}
      options={options}
      columns={6}
      fieldLabel={fieldLabel}
      inline={inline}
      triggerIconSize={triggerIconSize}
      triggerClassName={triggerClassName}
      triggerAriaLabel={triggerAriaLabel}
    />
  );
}
