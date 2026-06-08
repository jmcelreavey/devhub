import { describe, expect, it } from "vitest";
import { localCalendarDateISO, previousWorkingDayISO } from "./local-calendar-date";

// May 2026 reference: 15 = Fri, 16 = Sat, 17 = Sun, 18 = Mon, 19 = Tue, 20 = Wed.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("localCalendarDateISO", () => {
  it("zero-pads month and day", () => {
    expect(localCalendarDateISO(at(2026, 1, 3))).toBe("2026-01-03");
    expect(localCalendarDateISO(at(2026, 12, 25))).toBe("2026-12-25");
  });
});

describe("previousWorkingDayISO", () => {
  it("steps back one weekday on normal days", () => {
    expect(previousWorkingDayISO(at(2026, 5, 19))).toBe("2026-05-18"); // Tue -> Mon
    expect(previousWorkingDayISO(at(2026, 5, 20))).toBe("2026-05-19"); // Wed -> Tue
  });

  it("skips the weekend back to Friday", () => {
    expect(previousWorkingDayISO(at(2026, 5, 18))).toBe("2026-05-15"); // Mon -> Fri
    expect(previousWorkingDayISO(at(2026, 5, 16))).toBe("2026-05-15"); // Sat -> Fri
    expect(previousWorkingDayISO(at(2026, 5, 17))).toBe("2026-05-15"); // Sun -> Fri
  });

  it("steps Friday back to Thursday", () => {
    expect(previousWorkingDayISO(at(2026, 5, 15))).toBe("2026-05-14"); // Fri -> Thu
  });
});
