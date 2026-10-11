import type { Page } from "@playwright/test";

export interface TopbarProblem {
  kind: "overlap" | "clipped" | "overflow" | "small-target";
  detail: string;
}

/** Smallest hit target the top bar promises for its own controls. */
export const MIN_TARGET_PX = 32;

/**
 * Measures the desktop top bar as rendered. Layout bugs ("Live links wraps",
 * "Profiles runs into Settings") are invisible to every other test here, so this
 * reads real boxes instead of asserting on markup.
 *
 * Recent-page links are exempt from the target size check: they are inline text
 * links and the whole strip is dropped on narrower bars.
 */
export async function auditTopbar(page: Page): Promise<TopbarProblem[]> {
  // The active tab scales in (tab-pop), so a box measured mid-animation reads
  // ~7% smaller than it settles at. Looping animations (spinners) are left alone.
  await page.evaluate(() =>
    Promise.all(
      (document.querySelector("header.hub-topbar")?.getAnimations({ subtree: true }) ?? [])
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate((minTarget) => {
    const problems: { kind: "overlap" | "clipped" | "overflow" | "small-target"; detail: string }[] = [];
    const bar = document.querySelector<HTMLElement>("header.hub-topbar");
    if (!bar) return [{ kind: "overflow", detail: "header.hub-topbar not found" }];

    const barRect = bar.getBoundingClientRect();
    const crumbs = bar.querySelector<HTMLElement>(".hub-crumbs");
    const crumbsRect = crumbs?.getBoundingClientRect();

    const name = (el: Element) =>
      (el.getAttribute("aria-label") || el.textContent || el.className || el.tagName)
        .toString()
        .trim()
        .slice(0, 40);

    const isVisible = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      // Crumbs that wrapped onto the clipped second line are dropped by design.
      if (crumbs?.contains(el) && crumbsRect) {
        return r.top >= crumbsRect.top - 1 && r.bottom <= crumbsRect.bottom + 1;
      }
      return true;
    };

    const controls = [...bar.querySelectorAll<HTMLElement>("a[href], button, .hub-section-tabs")].filter(isVisible);

    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.left < barRect.left - 1 || r.right > barRect.right + 1) {
        problems.push({ kind: "overflow", detail: `${name(el)} sits outside the bar` });
      }
      const inCrumbs = Boolean(crumbs?.contains(el));
      const isGroup = el.classList.contains("hub-section-tabs");
      if (!inCrumbs && !isGroup && (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)) {
        problems.push({
          kind: "small-target",
          detail: `${name(el)} is ${Math.round(r.width)}x${Math.round(r.height)}`,
        });
      }
    }

    // Pairwise overlap, ignoring nesting (a tab inside the tab group is fine).
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i];
        const b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 1 && h > 1) {
          problems.push({ kind: "overlap", detail: `${name(a)} overlaps ${name(b)}` });
        }
      }
    }

    // Truncation: ellipsised text or a scrolling tab strip hides content.
    const all = [bar, ...bar.querySelectorAll<HTMLElement>("*")].filter(isVisible);
    for (const el of all) {
      if (crumbs?.contains(el) || el === crumbs) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const style = getComputedStyle(el);
      const clips =
        style.textOverflow === "ellipsis" ||
        style.overflowX === "hidden" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll";
      if (clips) {
        problems.push({
          kind: "clipped",
          detail: `${name(el)} is cut off (${el.scrollWidth}px of ${el.clientWidth}px)`,
        });
      }
    }

    return problems;
  }, MIN_TARGET_PX);
}
