"use client";

import {
  ListChecks,
  Sprout,
  Wrench,
  ShoppingCart,
  BookOpen,
  Lightbulb,
  Briefcase,
  Coffee,
  Code,
  Dumbbell,
  Heart,
  Plane,
  Star,
  Tag,
  Home,
  Hammer,
} from "lucide-react";
import { createElement } from "react";
import type { ComponentType, SVGProps } from "react";

export type ChecklistIconName =
  | "list"
  | "sprout"
  | "wrench"
  | "hammer"
  | "shopping-cart"
  | "book"
  | "lightbulb"
  | "briefcase"
  | "coffee"
  | "code"
  | "dumbbell"
  | "heart"
  | "plane"
  | "star"
  | "tag"
  | "home";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const ICONS: Record<ChecklistIconName, LucideIcon> = {
  list: ListChecks,
  sprout: Sprout,
  wrench: Wrench,
  hammer: Hammer,
  "shopping-cart": ShoppingCart,
  book: BookOpen,
  lightbulb: Lightbulb,
  briefcase: Briefcase,
  coffee: Coffee,
  code: Code,
  dumbbell: Dumbbell,
  heart: Heart,
  plane: Plane,
  star: Star,
  tag: Tag,
  home: Home,
};

export const CHECKLIST_ICON_NAMES = Object.keys(ICONS) as ChecklistIconName[];

export function isChecklistIconName(value: unknown): value is ChecklistIconName {
  return typeof value === "string" && value in ICONS;
}

export function getChecklistIcon(name: string | undefined | null): LucideIcon {
  return isChecklistIconName(name) ? ICONS[name] : ListChecks;
}

export function ChecklistIcon({
  name,
  size = 14,
  ...rest
}: { name?: string | null; size?: number } & Omit<SVGProps<SVGSVGElement>, "name" | "size">) {
  return createElement(getChecklistIcon(name ?? undefined), {
    size,
    "aria-hidden": true,
    ...rest,
  });
}
