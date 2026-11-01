import { ReactNode } from "react";

export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="text-xs mt-3 text-danger">{children}</p>;
}
