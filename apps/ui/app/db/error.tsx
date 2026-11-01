"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open the database workspace",
  hint: (
    <>
      Check the connection settings, credentials and network access.
      Local SQLite files need a readable file path.
    </>
  ),
});
