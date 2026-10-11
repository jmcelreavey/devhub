export async function postIntegration(body: unknown, alerts = false) {
  const response = await fetch("/api/integrations" + (alerts ? "/alerts" : ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed. Refresh and try again.");
  return result;
}
