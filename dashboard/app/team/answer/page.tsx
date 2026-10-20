import { SuggestedAnswer } from "./SuggestedAnswer";
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <div className="page-wrapper"><h1 className="text-xl font-semibold mb-4">Suggested answer</h1><SuggestedAnswer token={token} /></div>;
}

