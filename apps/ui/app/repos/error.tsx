"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't scan repositories",
  hint: <>Check that the repos directory exists and is readable — it is configured on <a href="/setup">Setup</a>.</>,
});
