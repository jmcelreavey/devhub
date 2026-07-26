import { ReactNode } from "react";

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-xs mt-3 text-danger">{children}</p>;
}
