"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't read the logs",
  hint: <>Logs come from the running services. Check they are up on the System page.</>,
});
