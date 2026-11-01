"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load setup",
  hint: <>Setup reads and writes <code>apps/ui/.env.local</code>. Check the file is present and writable.</>,
});
