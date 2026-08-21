import { LearnScreen } from "./client";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `Learn · ${decodeURIComponent(name)}` };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ lab?: string; domain?: string; owned?: string }>;
}) {
  const [{ name }, { lab, domain, owned }] = await Promise.all([params, searchParams]);
  return (
    <LearnScreen
      name={decodeURIComponent(name)}
      focusLab={lab?.trim() || undefined}
      domain={domain?.trim() || undefined}
      ownedRepo={owned?.trim() || undefined}
    />
  );
}
