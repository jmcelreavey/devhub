import { z } from "zod";

const preferenceKey = z.string().regex(/^devhub:[a-z0-9][a-z0-9:-]{0,100}$/);
export const pageBrowserSchema = z.object({
  preferences: z.array(preferenceKey).max(10).refine(keys => new Set(keys).size === keys.length, "Duplicate preference").optional(),
  clipboard: z.boolean().optional(),
  externalLinks: z.boolean().optional(),
  navigation: z.array(z.string().max(240)).max(30).optional(),
  createNote: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/).optional(),
}).strict();

export const pageActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preference"), key: preferenceKey, value: z.string().max(32000).nullable().optional() }).strict(),
  z.object({ kind: z.literal("clipboard"), text: z.string().max(32000) }).strict(),
  z.object({ kind: z.literal("external"), href: z.string().max(4096).url().refine(href => {
    const url = new URL(href);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  }) }).strict(),
  z.object({ kind: z.literal("navigate"), path: z.string().max(240) }).strict(),
  z.object({ kind: z.literal("createNote"), markdown: z.string().max(32000), expectedModified: z.null() }).strict(),
]);
export type PageAction = z.infer<typeof pageActionSchema>;
export class PageActionError extends Error {}
export const pageActionRequestSchema = z.object({
  page: z.string().max(240), revision: z.string().regex(/^[a-f0-9]{64}$/), action: pageActionSchema,
}).strict();

export function allowsPageAction(browser: z.infer<typeof pageBrowserSchema> | undefined, action: PageAction): boolean {
  if (!browser) return false;
  switch (action.kind) {
    case "preference": return browser.preferences?.includes(action.key) ?? false;
    case "clipboard": return browser.clipboard === true;
    case "external": return browser.externalLinks === true;
    case "navigate": return browser.navigation?.includes(action.path) ?? false;
    case "createNote": return !!browser.createNote;
  }
}
