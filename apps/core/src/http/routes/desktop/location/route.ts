import { isTranslocatedAppPath } from "../../../../lib/desktop/translocation";
import { desktopLocation } from "../../../../../../../packages/shared/actions/desktop";



/** Whether this process is still inside a DMG or App Translocation. No paths are returned. */
export function GET() {
  return desktopLocation.handler({}, { execute: () => {
    const flagged = process.env["DEVHUB_APP_TRANSLOCATED"] === "1";
    return Response.json({
      translocated: flagged || isTranslocatedAppPath(process.execPath),
    });
  } }) as Response;
}
