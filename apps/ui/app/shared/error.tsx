"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load live links",
  hint: <>Live links need GitHub access. Check your GitHub credentials in <code>.env.local</code>.</>,
});
