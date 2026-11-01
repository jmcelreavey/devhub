import { z } from "zod";

export const themePaletteTokens = ["bg", "bg-sidebar", "bg-surface", "bg-elevated", "bg-overlay", "border", "border-muted", "text", "text-muted", "text-subtle", "control-border", "info", "accent", "accent-hover", "accent-text", "accent-text-hover", "accent-dim", "accent-fg", "success", "success-dim", "warning", "warning-dim", "danger", "danger-dim"] as const;
export const themeColourSchema = z.string().max(40).regex(/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba\(\s*(?:\d{1,3}\s*,\s*){3}(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\))$/i);
export const themePaletteSchema = z.record(z.enum(themePaletteTokens), themeColourSchema);
