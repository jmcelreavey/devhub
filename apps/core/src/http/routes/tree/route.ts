import { getVaultTree } from "../../../lib/vault/create-vault-routes";
import { notesTree } from "../../../../../../packages/shared/actions/vault";


export const GET = async () => {
  try {
    const tree = await notesTree.handler(notesTree.input.parse({}), { list: () => getVaultTree("notes") });
    return Response.json(tree);
  } catch (err) {
    console.error("[api:tree]", err);
    return Response.json([], { status: 500 });
  }
};
