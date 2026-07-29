"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Trash2 } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";

export interface LibraryNavItem {
  slug: string;
  title: string;
  href: string;
  description?: string;
}

export interface LibraryNavGroup {
  id: string;
  label: string;
  /** Collapsed even when it is the active group. */
  secondary?: boolean;
  deletable?: boolean;
  items: LibraryNavItem[];
}

type ManualState = Record<string, boolean>;

const EMPTY: ManualState = {};

/**
 * Manual expand/collapse overrides, in sessionStorage.
 *
 * An external store rather than an effect: reading storage during an effect and
 * calling setState causes a cascading render on every mount, and a lazy
 * `useState` initialiser would read storage during SSR where it does not exist.
 * Snapshots are memoised per key so React sees a stable reference.
 */
const cache = new Map<string, { raw: string | null; value: ManualState }>();

function readManual(key: string): ManualState {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  let value: ManualState = EMPTY;
  try {
    value = raw ? (JSON.parse(raw) as ManualState) : EMPTY;
  } catch {
    value = EMPTY;
  }
  cache.set(key, { raw, value });
  return value;
}

function changeEvent(key: string): string {
  return `${key}:changed`;
}

function subscribeManual(key: string, onChange: () => void): () => void {
  const name = changeEvent(key);
  window.addEventListener(name, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(name, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeManual(key: string, next: ManualState): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode — the nav still works, it just forgets */
  }
  window.dispatchEvent(new Event(changeEvent(key)));
}

/**
 * Grouped sidebar navigation for a content library.
 *
 * Deliberately not the generic `FileTree`: these libraries browse by area and
 * title, not by filename, and a nav that shows `desktop-recovery` where the
 * page says "Recovering the desktop app" is a nav people stop trusting.
 *
 * Only the group you are reading is expanded. With everything open this was a
 * long scroll — a better-labelled version of the flat file list it replaced.
 * Manual toggles are remembered per library; the active group always opens.
 */
export function LibraryNav({
  groups,
  search,
  basePath,
  storageKey,
  label,
  noun = "items",
  deletingGroup,
  onDeleteGroup,
}: {
  groups: LibraryNavGroup[];
  search: string;
  /** Route prefix, e.g. "/docs". Group headings link to `${basePath}/${id}`. */
  basePath: string;
  /** sessionStorage key — must differ per library or they toggle each other. */
  storageKey: string;
  /** Accessible name for the nav landmark. */
  label: string;
  noun?: string;
  deletingGroup?: string | null;
  onDeleteGroup?: (group: LibraryNavGroup) => void;
}) {
  const pathname = usePathname();
  const query = search.trim().toLowerCase();

  const activeGroup = useMemo(() => {
    const match = groups.find((group) => group.items.some((item) => item.href === pathname));
    if (match) return match.id;
    // Area index pages (/docs/guides) have no item of their own.
    const fromPath = pathname.replace(new RegExp(`^${basePath}/?`), "").split("/")[0];
    return groups.some((group) => group.id === fromPath) ? fromPath : null;
  }, [groups, pathname, basePath]);

  const subscribe = useCallback(
    (onChange: () => void) => subscribeManual(storageKey, onChange),
    [storageKey],
  );
  const getSnapshot = useCallback(() => readManual(storageKey), [storageKey]);
  const manual = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const toggle = useCallback(
    (id: string, open: boolean) => writeManual(storageKey, { ...manual, [id]: open }),
    [manual, storageKey],
  );

  const filtered = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.title.toLowerCase().includes(query) ||
            item.slug.toLowerCase().includes(query) ||
            (item.description ?? "").toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  if (filtered.length === 0) {
    // "No match" and "nothing to match against" are different failures, and
    // conflating them is how a broken content directory looked like a broken
    // search. Only claim a query failed when there was one.
    return (
      <p className="lib-nav-empty">
        {query
          ? `No ${noun} match “${search.trim()}”.`
          : `No ${noun} found in this workspace.`}
      </p>
    );
  }

  return (
    <nav className="lib-nav" aria-label={label}>
      {filtered.map((group) => {
        // A search must never hide its own results behind a collapsed group.
        const open = query
          ? true
          : (manual[group.id] ?? (group.id === activeGroup && !group.secondary));
        return (
          <div key={group.id} className="lib-nav-group">
            <div className="lib-nav-heading-row">
              <button
                type="button"
                className="lib-nav-toggle"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                onClick={() => toggle(group.id, !open)}
              >
                <ChevronDown size={11} className="lib-nav-chevron" aria-hidden />
              </button>
              <Link
                href={`${basePath}/${group.id}`}
                className="lib-nav-heading"
                data-active={group.id === activeGroup}
              >
                {group.label}
                <span className="lib-nav-count">{group.items.length}</span>
              </Link>
              {group.deletable && onDeleteGroup ? (
                <HoverTip
                  label={deletingGroup === group.id ? "Deleting…" : `Delete folder ${group.label}`}
                >
                  <button
                    type="button"
                    className="lib-nav-delete reveal-on-hover"
                    disabled={deletingGroup === group.id}
                    onClick={() => onDeleteGroup(group)}
                  >
                    <Trash2 size={12} strokeWidth={2.5} aria-hidden />
                    <span className="sr-only">Delete folder {group.label}</span>
                  </button>
                </HoverTip>
              ) : null}
            </div>
            {open ? (
              <ul className="lib-nav-list">
                {group.items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={item.href}
                      className="lib-nav-link"
                      data-active={pathname === item.href}
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
