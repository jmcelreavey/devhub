"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load agents and skills",
  hint: <>Check the skills and agents directories are readable, then try again.</>,
});
