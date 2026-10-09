import RuntimePage from "./runtime-page";

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <RuntimePage name={name} />;
}
