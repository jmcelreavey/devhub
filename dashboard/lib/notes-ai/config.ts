/** True when AI_API_KEY is set — notes work without this; AI is optional. */
export function isNotesAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}
