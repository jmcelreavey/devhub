import { PageHeader } from "@/components/PageHeader";
import { TerminalView } from "@/components/TerminalView";

export const metadata = { title: "Terminal · DevHub" };

export default function TerminalPage() {
  return (
    <div className="page-wrapper" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHeader title="Terminal" subtitle="Local shell · opens at your developer directory" />
      <TerminalView />
    </div>
  );
}
