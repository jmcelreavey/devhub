"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open ChatGPT",
  hint: <>This tab embeds the ChatGPT desktop app. Check it is installed and running.</>,
});
