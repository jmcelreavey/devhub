"use client";
import { openWriteReview } from "@/components/integrations/WriteReview";
import type { WriteProposal } from "./write-types";

/** Legacy response shapes after confirmation; null cancels the caller's remaining work too. */
export async function integrationFetch(url: string, init: RequestInit): Promise<Response | null> {
  const response = await fetch(url, init);
  if (response.headers?.get("x-devhub-confirmation") !== "required") return response;
  const { proposal } = await response.json() as { proposal: WriteProposal };
  const result = await openWriteReview(proposal);
  if (!result) return null;
  if (result.state !== "succeeded") return Response.json({ error: result.detail ?? "The action was not completed. Check Recent actions in Integrations." }, { status: 409 });
  const item = result.receipt?.item;
  return Response.json(item ? { key: item.ref.id, url: item.url } : { key: "ref" in result.input ? result.input.ref.id : "", ok: true }, { status: item ? 201 : 200 });
}
