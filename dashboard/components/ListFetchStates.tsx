import type { ReactNode } from "react";
import { AsyncListSection } from "./AsyncListSection";
import { FetchError } from "./FetchError";
import { LoadingLine } from "./LoadingLine";

export interface ListFetchStatesProps {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  isEmpty: boolean;
  empty: ReactNode;
  loadingMessage?: string;
  children: ReactNode;
}

export function ListFetchStates({
  loading,
  error,
  onRetry,
  isEmpty,
  empty,
  loadingMessage,
  children,
}: ListFetchStatesProps) {
  if (error) return <FetchError message={error} onRetry={onRetry} />;

  return (
    <AsyncListSection
      loading={loading}
      isEmpty={isEmpty}
      empty={empty}
      loadingFallback={<LoadingLine message={loadingMessage} />}
    >
      {children}
    </AsyncListSection>
  );
}
