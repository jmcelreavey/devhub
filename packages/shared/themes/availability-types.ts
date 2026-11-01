export interface ThemeCalendarDate {
  month: number;
  day: number;
}

export type ThemeAvailability =
  | { type: "fixed"; start: ThemeCalendarDate; end: ThemeCalendarDate }
  | { type: "easter"; offsetStart: number; offsetEnd: number };
