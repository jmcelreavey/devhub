import { withErrorHandler } from "../../../../lib/api-utils";
import { discoverSqliteFiles } from "../../../../lib/db/discover-sqlite";
import { dbDiscover } from "../../../../../../../packages/shared/actions/db";
import { requireAuth } from "../_shared";


/**
 * SQLite files sitting in the repos you already have checked out.
 *
 * A walk of the scan directory, so it is deliberately behind the "Add
 * connection" panel rather than on the rail's load path.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  return await dbDiscover.handler(dbDiscover.input.parse({}), {
    run: async () => Response.json({ files: discoverSqliteFiles() }),
  }) as Response;
}, "db.discover");
