import { statusPackagedCheckout } from "../../../../../../../packages/shared/actions/status";
import { withErrorHandler } from "../../../../lib/api-utils";
import { getPackagedCheckoutStatus } from "../../../../lib/desktop/bundle-source";


/** Pollable probe for the packaged-checkout stale banner (no auth — reports capability only). */
export const GET = withErrorHandler(async () => {
  return await statusPackagedCheckout.handler({}, { read: async () => {
  return Response.json(await getPackagedCheckoutStatus());
  } }) as Response;
}, "status/packaged-checkout");
