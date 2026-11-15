import { meetingOrganizer } from "./access.js";
import { createMeetingClient, MeetingServiceError } from "./client.js";
import { serviceUnavailable } from "../lib/errors.js";
export function partnerMeetingId(
  link: string | undefined,
  webOrigin = process.env.GSW_MEETINGS_WEB_ORIGIN,
) {
  if (!link || !webOrigin) return null;
  try {
    const url = new URL(link),
      base = new URL(webOrigin);
    return url.protocol === "https:" &&
      url.origin === base.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/meet\/[a-zA-Z0-9_-]{1,200}$/.test(url.pathname)
      ? url.pathname.slice(6)
      : null;
  } catch {
    return null;
  }
}
export function meetingStartUtc(start: string, timezone: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(start)) {
    const date = new Date(start);
    if (!Number.isFinite(date.getTime())) throw Error("Invalid meeting start");
    return date.toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    start,
  );
  if (!match) throw Error("Invalid meeting start");
  const values = match.slice(1).map(Number),
    wall = Date.UTC(
      values[0]!,
      values[1]! - 1,
      values[2]!,
      values[3]!,
      values[4]!,
      values[5] || 0,
    );
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const rendered = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    if (rendered === wall) return new Date(instant).toISOString();
    instant += wall - rendered;
  }
  throw Error("Choose a valid local meeting start time");
}
export async function syncCalendarMeeting(
  userId: string,
  accountId: string,
  link: string | undefined,
  details?: { title: string; start: string; timeZone?: string | undefined },
) {
  const meetingId = partnerMeetingId(link);
  if (!meetingId) return;
  if (process.env.GSW_MEETINGS_ENABLED !== "true")
    throw serviceUnavailable("meetings_disabled");
  const organizer = await meetingOrganizer(userId, accountId, false);
  try {
    const client = createMeetingClient({
      apiUrl: process.env.GSW_MEETINGS_API_URL ?? "",
      webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "",
      signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "",
    });
    if (details) {
      const timezone = details.timeZone ?? "Etc/UTC";
      await client.updateRoom(organizer, {
        meetingId,
        title: details.title,
        scheduledAt: meetingStartUtc(details.start, timezone),
        timezone,
      });
    } else await client.cancelRoom(organizer, meetingId);
  } catch (e) {
    if (e instanceof MeetingServiceError && e.status === 403) return;
    throw serviceUnavailable(
      e instanceof MeetingServiceError && e.status === 409
        ? "End the active meeting before removing or canceling its link."
        : "Could not synchronize the meeting. Please retry.",
    );
  }
}
