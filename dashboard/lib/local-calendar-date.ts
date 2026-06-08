/** YYYY-MM-DD in the machine's local calendar (not UTC midnight from `toISOString`). */
export function localCalendarDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for the most recent working day strictly before `from` (skips Sat/Sun). */
export function previousWorkingDayISO(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return localCalendarDateISO(d);
}
