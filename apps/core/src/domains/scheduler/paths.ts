import path from "node:path";
import { checkoutStateDir } from "../../../../../packages/shared/storage/profile-state.ts";

export function schedulerStateDir(): string {
  const checkout = checkoutStateDir();
  if (checkout) return checkout;
  const home = process.env.HOME;
  if (!home) throw new Error("HOME environment variable is not set");
  return path.join(home, ".local/state/devhub");
}
