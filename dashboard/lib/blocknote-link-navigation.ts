import {
  joinRelative,
  normalizeRelativePath,
  parentDir,
  stripExtension,
} from "../../shared/vault/relative-path.ts";
import { VAULT_PATHS, type VaultId } from "../../shared/vault/vault-routes.ts";

export interface LinkNavigationContext {
  vaultId: VaultId;
  contentSlug?: string;
  currentPathname: string;
}

export interface BlockNoteLinkClickHandlers {
  push: (path: string) => void;
  openExternal: (href: string) => void;
}

const EXTERNAL_HREF = /^(https?:|mailto:|tel:)/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF.test(href.trim());
}

export function shouldOpenInNewTab(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}

export function getLinkHrefFromEvent(event: MouseEvent): string | null {
  const anchor = (event.target as HTMLElement | null)?.closest?.("a");
  if (!anchor) return null;
  return anchor.getAttribute("href");
}

/** Resolve an in-app dashboard route, or null when the href should open externally. */
export function resolveInternalAppPath(
  href: string,
  context: LinkNavigationContext,
): string | null {
  const trimmed = href.trim();
  if (!trimmed || isExternalHref(trimmed)) return null;

  const docsPaths = VAULT_PATHS.docs;
  const notesPaths = VAULT_PATHS.notes;

  if (trimmed.startsWith("#")) {
    return `${context.currentPathname}${trimmed}`;
  }

  if (trimmed === "/docs" || trimmed.startsWith("/docs/")) {
    const slug = docsPaths.slugFromPathname(trimmed === "/docs" ? "/docs" : trimmed);
    if (slug !== null) {
      return docsPaths.pageHref(stripExtension(slug, ".md"));
    }
  }

  if (trimmed === "/notes" || trimmed.startsWith("/notes/")) {
    const slug = notesPaths.slugFromPathname(trimmed === "/notes" ? "/notes" : trimmed);
    if (slug !== null) {
      return notesPaths.pageHref(stripExtension(slug, ".json"));
    }
  }

  const normalizedHref = trimmed.replace(/\\/g, "/");

  if (/\.md$/i.test(normalizedHref) || context.vaultId === "docs") {
    const withoutExt = stripExtension(normalizedHref, ".md");
    let docSlug: string;
    if (
      context.vaultId === "docs" &&
      context.contentSlug &&
      !normalizedHref.startsWith("/")
    ) {
      docSlug = joinRelative(parentDir(context.contentSlug), withoutExt);
    } else if (normalizedHref.startsWith("/")) {
      docSlug = normalizeRelativePath(withoutExt.replace(/^\//, ""));
    } else {
      docSlug = normalizeRelativePath(withoutExt);
    }
    return docsPaths.pageHref(docSlug);
  }

  const withoutExt = stripExtension(normalizedHref, ".json");
  const noteSlug =
    normalizedHref.startsWith("/") || !context.contentSlug
      ? normalizeRelativePath(withoutExt.replace(/^\//, ""))
      : joinRelative(parentDir(context.contentSlug), withoutExt);
  return notesPaths.pageHref(noteSlug);
}

export function handleBlockNoteLinkClick(
  event: MouseEvent,
  href: string,
  context: LinkNavigationContext,
  handlers: BlockNoteLinkClickHandlers,
): void {
  event.preventDefault();

  if (isExternalHref(href)) {
    handlers.openExternal(href);
    return;
  }

  const appPath = resolveInternalAppPath(href, context);
  if (!appPath) {
    handlers.openExternal(href);
    return;
  }

  if (shouldOpenInNewTab(event)) {
    window.open(appPath, "_blank", "noopener,noreferrer");
    return;
  }

  handlers.push(appPath);
}
