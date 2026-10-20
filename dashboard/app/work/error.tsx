"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load tasks",
  hint: <>Tasks merges local tasks with Jira. If Jira is configured, check the token is still valid.</>,
});
