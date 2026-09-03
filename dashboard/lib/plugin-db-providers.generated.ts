/* Empty baseline — rewritten by lib/plugins/db-materialize.ts when a plugin declares dashboard.connections.
 * Locally rewritten files use git update-index --skip-worktree so they never show as repo churn.
 */
import type { DbConnectionProvider } from "./db/provider";

export const PLUGIN_DB_PROVIDERS: DbConnectionProvider[] = [];
