import { RepoHub } from "./client";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: name };
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <RepoHub name={name} />;
}
