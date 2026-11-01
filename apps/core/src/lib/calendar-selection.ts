import { createCalendarSelection } from "../domains/calendar/selection";
import { safeReadJSON, withMutex, writeAtomic } from "./atomic-write";
import { getRepoRoot } from "./notes/dir";

export const { readCalendarSelection, hasSavedCalendarSelection, writeCalendarSelection } = createCalendarSelection({ getRepoRoot, safeReadJSON, withMutex, writeAtomic });
