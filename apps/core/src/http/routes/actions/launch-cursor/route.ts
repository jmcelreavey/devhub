import { launchCursor } from "../../../../../../../packages/shared/actions/misc-ui";
import { launchDesktopApp } from "../../../../lib/launch/desktop";

const CONFIG = {
  appName: "Cursor",
  macAppName: "Cursor",
  linuxBinName: "cursor",
  releasesUrl: "https://cursor.com/download",
  webFallbackUrl: "https://cursor.com/download",
};

export async function POST() {
  const result = await launchCursor.handler(launchCursor.input.parse({}), { execute: () => launchDesktopApp(CONFIG) }) as Awaited<ReturnType<typeof launchDesktopApp>>;
  if ("status" in result) {
    return Response.json(result, { status: result.status });
  }
  return Response.json(result);
}
