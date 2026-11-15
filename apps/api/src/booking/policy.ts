import { z } from "zod";
import { calendarStartInstant } from "../mobile/notificationPolicy.js";
export const durations = [15, 20, 30, 45, 60] as const;
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const windowSchema = z
  .object({ day: z.number().int().min(0).max(6), start: clock, end: clock })
  .strict()
  .refine((w) => w.end > w.start, "A window must end after it starts");
export const eventLinkSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(3)
      .max(70),
    calendarId: z.string().min(1).max(200),
    timeZone: z
      .string()
      .max(100)
      .refine((t) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: t });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone"),
    enabled: z.boolean(),
    mode: z.enum(["fixed", "windows"]),
    duration: z.union(durations.map((n) => z.literal(n))),
    allowedDurations: z
      .array(z.union(durations.map((n) => z.literal(n))))
      .min(1)
      .max(5),
    windows: z.array(windowSchema).max(28),
    fixedSlots: z.array(z.object({ date, start: clock }).strict()).max(200),
    unavailableDates: z.array(date).max(200),
    approval: z.enum(["manual", "auto"]),
    phoneRequired: z.boolean(),
    messageRequired: z.boolean(),
    noticeHours: z.number().int().min(1).max(720),
    location: z.string().trim().max(500),
    meetingUrl: z.union([
      z.literal(""),
      z
        .url()
        .max(2000)
        .refine((s) => s.startsWith("https://"), "Use an HTTPS meeting URL"),
    ]),
    generateMeeting: z.boolean(),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (
      x.enabled &&
      !(x.mode === "fixed" ? x.fixedSlots.length : x.windows.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Add at least one availability slot or window",
      });
    if (x.generateMeeting && x.meetingUrl)
      ctx.addIssue({
        code: "custom",
        message:
          "Choose a supplied meeting link or an automatically generated meeting",
      });
  });
export type LinkSettings = z.infer<typeof eventLinkSchema>;
export type Interval = { start: string; end: string };
export function dayInZone(instant: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function horizon(now: Date, timeZone: string) {
  const first = dayInZone(now, timeZone),
    end = new Date(first + "T12:00:00Z");
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 6);
  end.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return { first, last: end.toISOString().slice(0, 10) };
}
export const overlaps = (a: Interval, b: Interval) =>
  Date.parse(a.start) < Date.parse(b.end) &&
  Date.parse(b.start) < Date.parse(a.end);
export function slotsForDay(
  settings: LinkSettings,
  day: string,
  duration: number,
  busy: Interval[],
  now = new Date(),
): Interval[] {
  const bounds = horizon(now, settings.timeZone);
  if (
    day < bounds.first ||
    day > bounds.last ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day)
  )
    return [];
  if (
    !durations.includes(duration as (typeof durations)[number]) ||
    (settings.mode === "fixed"
      ? duration !== settings.duration
      : !settings.allowedDurations.includes(
          duration as (typeof durations)[number],
        ))
  )
    return [];
  if (settings.unavailableDates.includes(day)) return [];
  const times: string[] = [];
  if (settings.mode === "fixed")
    times.push(
      ...settings.fixedSlots.filter((s) => s.date === day).map((s) => s.start),
    );
  else
    for (const w of settings.windows.filter(
      (w) => w.day === new Date(day + "T12:00:00Z").getUTCDay(),
    )) {
      const minutes = (s: string) =>
        Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      for (let m = minutes(w.start); m + duration <= minutes(w.end); m += 5)
        times.push(
          `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
        );
    }
  const result: Interval[] = [];
  for (const time of new Set(times)) {
    try {
      const start = calendarStartInstant(
          day + "T" + time + ":00",
          settings.timeZone,
        ),
        end = new Date(start.getTime() + duration * 60000);
      if (start.getTime() < now.getTime() + settings.noticeHours * 3600000)
        continue;
      if (settings.mode === "windows") {
        const endClock = new Intl.DateTimeFormat("en-GB", {
          timeZone: settings.timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(end);
        if (
          dayInZone(end, settings.timeZone) !== day ||
          !settings.windows.some(
            (w) =>
              w.day === new Date(day + "T12:00:00Z").getUTCDay() &&
              time >= w.start &&
              endClock <= w.end &&
              endClock > time,
          )
        )
          continue;
      }
      const slot = { start: start.toISOString(), end: end.toISOString() };
      if (!busy.some((b) => overlaps(slot, b))) result.push(slot);
    } catch {}
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
}
export const bookingInputSchema = z
  .object({
    requestId: z.uuid(),
    start: z.iso.datetime(),
    duration: z.union(durations.map((n) => z.literal(n))),
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    phone: z.string().trim().max(50).default(""),
    message: z.string().trim().max(2000).default(""),
    website: z.string().max(200).default(""),
  })
  .strict();
export function validateGuest(
  settings: LinkSettings,
  input: z.infer<typeof bookingInputSchema>,
) {
  if (input.website) throw new Error("Booking could not be submitted");
  if (settings.phoneRequired && !input.phone)
    throw new Error("Phone number is required");
  if (settings.messageRequired && !input.message)
    throw new Error("Message is required");
}
