import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { discoverSqliteFiles } from "@/lib/db/discover-sqlite";
import { requireAuth } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * SQLite files sitting in the repos you already have checked out.
 *
 * A walk of the scan directory, so it is deliberately behind the "Add
 * connection" panel rather than on the rail's load path.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  return NextResponse.json({ files: discoverSqliteFiles() });
}, "db.discover");
