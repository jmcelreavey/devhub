"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Datadog",
  hint: <>Check <code>DATADOG_API_KEY</code> and <code>DATADOG_APPLICATION_KEY</code> in <code>.env.local</code>, and that both keys are still valid.</>,
});
