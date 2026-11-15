import { z } from "zod";
import { badRequest } from "../lib/errors.js";
import { eventLinkSchema } from "./policy.js";
function normalizeSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const settings = { ...value } as Record<string, unknown>;
  if (Array.isArray(settings.unavailableDates))
    settings.unavailableDates = settings.unavailableDates
      .map((s) => (typeof s === "string" ? s.trim() : s))
      .filter((s) => s !== "");
  if (settings.mode === "windows") settings.fixedSlots = [];
  if (settings.mode === "fixed") {
    settings.windows = [];
    settings.allowedDurations = [settings.duration];
  }
  return settings;
}
export const eventLinkRequestSchema = z
  .object({
    accountId: z.uuid(),
    id: z.uuid().optional(),
    settings: z.preprocess(normalizeSettings, eventLinkSchema),
  })
  .strict();
export function eventLinkValidationMessage(issues: z.core.$ZodIssue[]) {
  return [
    ...new Set(
      issues.slice(0, 4).map((issue) => {
        const path = issue.path.filter((p) => p !== "settings");
        const key = String(path[0] ?? "");
        const row = typeof path[1] === "number" ? ` ${path[1] + 1}` : "";
        const fields: Record<string, string> = {
          accountId: "Mailbox",
          id: "Booking link",
          name: "Booking name",
          slug: "Link slug",
          calendarId: "Calendar",
          timeZone: "Schedule timezone",
          duration: "Meeting duration",
          allowedDurations: "Meeting durations",
          windows: "Availability window",
          fixedSlots: "Exact slot",
          unavailableDates: "Unavailable date",
          noticeHours: "Advance notice",
          meetingUrl: "Meeting URL",
        };
        const label = (fields[key] ?? "Event link") + row;
        if (key === "unavailableDates")
          return `${label}: Use a real date in YYYY-MM-DD format, or leave the field blank.`;
        if (key === "fixedSlots" && path[2] === "date")
          return `${label}: Choose a valid meeting date.`;
        if (key === "slug")
          return "Link slug: Use 3–70 lowercase letters, numbers, and single hyphens.";
        if (key === "calendarId")
          return "Calendar: Choose a calendar for this mailbox.";
        if (key === "allowedDurations")
          return "Meeting durations: Select at least one meeting length.";
        if (key === "accountId")
          return "Mailbox: Reload the page and select your mailbox again.";
        if (key === "timeZone")
          return "Schedule timezone: Choose a valid IANA timezone, such as America/Detroit.";
        if (key === "noticeHours")
          return "Advance notice: Enter a whole number of hours between 1 and 720.";
        return `${label}: ${issue.message === "Invalid input" ? "Check this field." : issue.message}`;
      }),
    ),
  ].join(" ");
}
export function parseEventLinkRequest(input: unknown) {
  const result = eventLinkRequestSchema.safeParse(input);
  if (!result.success)
    throw badRequest(eventLinkValidationMessage(result.error.issues));
  return result.data;
}
