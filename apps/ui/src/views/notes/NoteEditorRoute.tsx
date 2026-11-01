import { useLocation } from "react-router-dom";
import NotePage from "../../../app/notes/[...path]/client";
import { FetchError } from "../../../components/ui/FetchError";

export function NoteEditorRoute() {
  const { pathname } = useLocation();

  let path: string[];
  try {
    path = pathname.slice("/notes/".length).replace(/\/+$/, "").split("/").map(decodeURIComponent);
  } catch {
    return <FetchError message="This note address is invalid." />;
  }

  return <NotePage key={pathname} path={path} />;
}
