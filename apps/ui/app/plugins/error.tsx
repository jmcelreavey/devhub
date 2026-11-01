"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn’t load plugins",
  hint: <>Your plugin settings haven’t changed. Try loading them again.</>,
});
