import { diagramPreviews } from "../../../../../../../packages/shared/actions/diagrams";
import { httpAction } from "../../../../lib/actions/http";
import { getDiagramPreviews } from "../../../../lib/diagrams/diagram-preview";


export const POST = httpAction(diagramPreviews, {
  input: (request) => request.json(),
  context: () => ({ previews: getDiagramPreviews }),
  response: (previews) => Response.json({ previews }),
});
