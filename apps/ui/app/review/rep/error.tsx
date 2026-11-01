"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the daily rep",
  hint: <>Reps are built from your PR queue. Check GitHub access under Setup → Integrations.</>,
});
