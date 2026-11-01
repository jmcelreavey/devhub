"use client";

import { VaultEditorPage } from "@/components/vault/VaultEditorPage";

export default function NotePage({
  path,
  notesAiConfigured,
}: {
  path: string[];
  notesAiConfigured?: boolean;
}) {
  return <VaultEditorPage vault="notes" path={path} notesAiConfigured={notesAiConfigured} />;
}
