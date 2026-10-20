"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the suggested answer",
  hint: <>It may have expired. Ask your teammate again from the task.</>,
});
