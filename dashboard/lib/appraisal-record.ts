/** POST cited evidence into the appraisal year note via /api/appraisal/evidence. */
export async function recordAppraisalEvidence(input: {
  title: string;
  theme: string;
  summary: string;
  url: string;
  date?: string;
  kind?: string;
}): Promise<{ created: boolean; slug: string; path: string; warning?: string | null }> {
  const res = await fetch("/api/appraisal/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      theme: input.theme,
      summary: input.summary,
      references: [input.url],
      date: input.date,
      kind: input.kind,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    created?: boolean;
    slug?: string;
    path?: string;
    warning?: string | null;
  };
  if (!res.ok) throw new Error(body.error ?? `Record failed (${res.status})`);
  return {
    created: Boolean(body.created),
    slug: body.slug ?? "",
    path: body.path ?? "",
    warning: body.warning,
  };
}

/** Create or revise a goal via /api/appraisal/year (same storage as MCP appraisal_set_goal). */
export async function setAppraisalGoal(input: {
  year: number;
  title: string;
  detail?: string;
  status?: string;
  id?: string;
}): Promise<{ created: boolean; slug: string; path: string }> {
  const res = await fetch("/api/appraisal/year", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year: input.year,
      title: input.title,
      detail: input.detail,
      status: input.status,
      id: input.id,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    created?: boolean;
    slug?: string;
    path?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `Goal save failed (${res.status})`);
  return {
    created: Boolean(body.created),
    slug: body.slug ?? "",
    path: body.path ?? "",
  };
}
