import type { ThemeAvailability, ThemeCalendarDate } from "@shared/themes/availability-types";
export type { ThemeCalendarDate, ThemeAvailability } from "@shared/themes/availability-types";

export function isThemeAvailable(availability: ThemeAvailability | undefined, date: Date): boolean {
  if (availability === undefined) return true;
  if (!availability || !Number.isFinite(date.getTime())) return false;

  const year = date.getFullYear();
  if (year < 1583 || year > 9999) return false;

  if (availability.type === "fixed") {
    const validDate = (value: ThemeCalendarDate) => {
      if (!value || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return false;
      const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return value.month >= 1 && value.month <= 12 && value.day >= 1 && value.day <= days[value.month - 1];
    };
    if (!validDate(availability.start) || !validDate(availability.end)) return false;
    const start = availability.start.month * 100 + availability.start.day;
    const end = availability.end.month * 100 + availability.end.day;
    const today = (date.getMonth() + 1) * 100 + date.getDate();
    return start <= end ? today >= start && today <= end : today >= start || today <= end;
  }

  if (availability.type !== "easter" || !Number.isInteger(availability.offsetStart)
    || !Number.isInteger(availability.offsetEnd) || availability.offsetStart < -60
    || availability.offsetEnd > 60 || availability.offsetStart > availability.offsetEnd) return false;

  const goldenNumber = year % 19;
  const century = Math.floor(year / 100);
  const yearOfCentury = year % 100;
  const centuryLeapDays = Math.floor(century / 4);
  const centuryRemainder = century % 4;
  const moonCorrection = Math.floor((century + 8) / 25);
  const solarCorrection = Math.floor((century - moonCorrection + 1) / 3);
  const epact = (19 * goldenNumber + century - centuryLeapDays - solarCorrection + 15) % 30;
  const leapDays = Math.floor(yearOfCentury / 4);
  const leapRemainder = yearOfCentury % 4;
  const weekdayCorrection = (32 + 2 * centuryRemainder + 2 * leapDays - epact - leapRemainder) % 7;
  const adjustment = Math.floor((goldenNumber + 11 * epact + 22 * weekdayCorrection) / 451);
  const total = epact + weekdayCorrection - 7 * adjustment + 114;
  const month = Math.floor(total / 31);
  const day = total % 31 + 1;
  const difference = (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, month - 1, day)) / 86_400_000;
  return difference >= availability.offsetStart && difference <= availability.offsetEnd;
}
