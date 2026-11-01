import { z } from "zod";

const calendarDate = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
}).strict().refine(value => value.day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][value.month - 1], {
  message: "Invalid calendar date",
  path: ["day"],
});

export const themeAvailabilitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), start: calendarDate, end: calendarDate }).strict(),
  z.object({
    type: z.literal("easter"),
    offsetStart: z.number().int().min(-60).max(60),
    offsetEnd: z.number().int().min(-60).max(60),
  }).strict().refine(value => value.offsetStart <= value.offsetEnd, {
    message: "The end must not precede the start",
    path: ["offsetEnd"],
  }),
]);
