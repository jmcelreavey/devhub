import { avatar } from "../../../../../../../packages/shared/actions/misc-ui";
import { resolveAtlassianAvatars } from "../../../../lib/jira/avatars";

/**
 * Resolve an Atlassian (Jira) avatar for an email.
 *
 * Used by PersonChip when the parent only has an address (calendar organizers,
 * …). Commit history prefers `/git/people` identity instead — this route is the
 * email-only fallback so every PersonChip consumer shares the same cascade.
 */
export async function GET(req: Request) {
  const { email } = avatar.input.parse({ email: new URL(req.url).searchParams.get("email")?.trim() ?? "" });
  if (!email || !email.includes("@")) {
    return Response.json({ url: null });
  }

  const map = await avatar.handler({ email }, { execute: ({ email }) => resolveAtlassianAvatars([email]) }) as Awaited<ReturnType<typeof resolveAtlassianAvatars>>;
  const url = map[email.toLowerCase()] ?? null;
  return Response.json({ url });
}
