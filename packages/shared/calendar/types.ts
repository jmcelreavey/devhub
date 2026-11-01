export interface CalendarPerson {
  email?: string;
  displayName?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  conferenceUrl?: string;
  /** Link to the event in Google Calendar. */
  htmlLink?: string;
  /** Attendee email addresses, if any. */
  attendees?: string[];
  /** Event organizer when Google returned one. */
  organizer?: CalendarPerson;
  /** Source calendar ID (for merged multi-calendar views). */
  calendarId?: string;
  /** Human-readable calendar name. */
  calendarName?: string;
  /** Google calendar color (hex). */
  calendarColor?: string;
  /** Stable UID for deduping the same event across calendars. */
  iCalUID?: string;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  /** Whether this calendar is checked in Google Calendar UI. */
  selected?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}
