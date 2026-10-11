// Mounts the game on its own for screenshot/QA runs (see harness.mjs).
import { createRoot } from "react-dom/client";
import { KonamiPong } from "@/components/shell/KonamiPong";

createRoot(document.getElementById("root") as HTMLElement).render(<KonamiPong autoStart />);
