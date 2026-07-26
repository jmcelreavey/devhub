"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the appraisal",
  hint: <>Appraisal reads evidence off disk and summarises with the AI provider. Check both are available.</>,
});
