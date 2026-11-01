import { httpAction } from "../../../../lib/actions/http";
import { statusServices } from "../../../../../../../packages/shared/actions/status";
import { readPaseoManaged } from "../../../../lib/paseo/managed";
import { listPaseoProviders } from "../../../../lib/paseo/providers";

export const GET = httpAction(statusServices, { input: () => ({}), context: () => ({ read: readServices }), response: (data) => Response.json(data) });

async function readServices() {
  try {
    await listPaseoProviders();
    return { agents: { active: true, uptime: null } };
  } catch {
    let optional = false;
    try {
      optional = readPaseoManaged() == null;
    } catch {
      optional = false;
    }
    return { agents: { active: false, uptime: null, optional } };
  }
}
