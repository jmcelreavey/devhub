"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load this document",
  hint: <>The file may have been moved or deleted outside the app.</>,
});
