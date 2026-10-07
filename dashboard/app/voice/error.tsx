"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Voice",
  hint: <>Check that the notes directory and <code>skills/shared/my-voice</code> are readable.</>,
});
