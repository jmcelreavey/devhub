"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load pull requests",
  hint: <>Check your GitHub credentials in <code>.env.local</code> and that <code>gh</code> is authenticated (<code>gh auth status</code>).</>,
});
