import { z } from "zod";
import { defineAction } from "./define.ts";

export const internalNavigationHref = z.string().trim().min(1).max(4_096)
  .refine((href) => href.startsWith("/") && !href.startsWith("//"), "Must be an internal DevHub path");
export const desktopNavigationInput = z.object({ href: internalNavigationHref, newTab: z.literal(true) });
export const uiOpenInput = z.object({
  href: z.string().trim().min(1).max(4_096)
    .refine((href) => href.startsWith("/") && !href.startsWith("//"), "Must be an internal DevHub path starting with /")
    .refine((href) => !href.startsWith("/api/"), "DevHub pages only — /api/ routes are not pages")
    .describe("Internal DevHub path to open, e.g. /notes/discovery/example or /work"),
  title: z.string().max(80).optional().describe("Unused today; reserved for a future tab-title override"),
}).meta({ additionalProperties: false });

export interface UiOpenContext {
  open: (href: string) => Promise<{ delivered: number; suppressed?: boolean; href: string }>;
}
export const uiOpen = defineAction<typeof uiOpenInput, UiOpenContext, { delivered: number; suppressed?: boolean; href: string }>({
  input: uiOpenInput,
  http: { reason: "Agent page-link resolution is narrower than the authenticated browser navigation channel; it does not grant browser navigation intent." },
  mcp: {
    name: "ui_open", toolset: "ui",
    description: "Resolve a DevHub page link for the user. Agent calls never change the selected page, chat or focus. Accepts internal hrefs such as /notes/<path>, /repos/<name>, /work, /agents, /skills and /search. Return the resulting link with your answer.",
  },
  handler: ({ href }, context) => context.open(href),
});

interface DesktopNavigationContext {
  publish: (input: z.output<typeof desktopNavigationInput>) => unknown;
}
export const desktopNavigation = defineAction<typeof desktopNavigationInput, DesktopNavigationContext, unknown>({
  input: desktopNavigationInput,
  http: { method: "POST", path: "/api/desktop/navigation" },
  mcp: { reason: "The local browser navigation channel requires dashboard auth and browser intent. Agents use ui_open and receive a suppressed link." },
  handler: (input, context) => context.publish(input),
});

export const desktopNavigationStream = defineAction({
  input: z.object({}),
  http: { method: "GET", path: "/api/desktop/navigation" },
  mcp: { reason: "Authenticated SSE subscription for desktop clients; not an agent action." },
  handler: (_input, context: { subscribe: () => unknown }) => context.subscribe(),
});
