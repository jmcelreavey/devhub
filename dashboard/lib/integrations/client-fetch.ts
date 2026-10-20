"use client";
import { openWriteReview } from "@/components/integrations/WriteReview";
import type { WriteProposal } from "./write-types";

/**
 * A write started by a person's click in DevHub. The header tells the server
 * this is a human intent (the click is the approval), so it executes at once
 * instead of opening a review. Legacy response shapes after confirmation; null
 * cancels the caller's remaining work too.
 */
export async function integrationFetch(url: string, init: RequestInit): Promise<Response | null> {
  const headers = new Headers(init.headers);
  headers.set("x-devhub-intent", "direct");
  const response = await fetch(url, { ...init, headers });
  if (response.headers?.get("x-devhub-confirmation") !== "required") return response;
  const { proposal } = await response.json() as { proposal: WriteProposal };
  const result = await openWriteReview(proposal);
  if (!result) return null;
  if (result.state !== "succeeded") return Response.json({ error: result.detail ?? "The action was not completed. Check Recent actions in Integrations." }, { status: 409 });
  const item = result.receipt?.item;
  return Response.json(item ? { key: item.ref.id, url: item.url } : { key: "ref" in result.input ? result.input.ref.id : "", ok: true }, { status: item ? 201 : 200 });
}
