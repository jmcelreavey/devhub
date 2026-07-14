/* Empty baseline — rewritten by lib/plugins/nav-materialize.ts when a plugin declares dashboard.nav.
 * Locally rewritten files use git update-index --skip-worktree so they never show as repo churn.
 */
import type { NavItem, SectionTab } from "./nav";

export const PLUGIN_NAV_ITEMS: NavItem[] = [];

export const PLUGIN_SECTION_TABS: Partial<Record<"library" | "system", SectionTab[]>> = {};
