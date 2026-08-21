import OwnerRepoPage from "./client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function Page({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  return <OwnerRepoPage owner={decodeURIComponent(owner)} name={decodeURIComponent(name)} />;
}
