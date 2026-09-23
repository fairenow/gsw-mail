import type { EngineCalendarEventInput } from "../engine/types.js";

export interface ParsedCalendarInvite extends EngineCalendarEventInput {
  uid?: string;
  method?: string;
}

const unescapeText = (value: string): string => value
  .replace(/\\n/gi, "\n")
  .replace(/\\,/g, ",")
  .replace(/\\;/g, ";")
  .replace(/\\\\/g, "\\")
  .trim();

const unfold = (input: string): string[] => input
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n")
  .replace(/\n[ \t]/g, "")
  .split("\n")
  .map((line) => line.trimEnd());

const property = (line: string): { name: string; params: Record<string, string>; value: string } | null => {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = left.split(";");
  if (!rawName) return null;
  const params = Object.fromEntries(rawParams.map((entry) => {
    const equals = entry.indexOf("=");
    return equals < 0 ? [entry.toUpperCase(), ""] : [entry.slice(0, equals).toUpperCase(), entry.slice(equals + 1).replace(/^"|"$/g, "")];
  }));
  return { name: rawName.toUpperCase(), params, value };
};

const localDateTime = (raw: string): { start: string; allDay: boolean; timeZone?: string } | null => {
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) {
    return { start: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`, allDay: true };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!match) return null;
  return {
    start: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}`,
    allDay: false,
    ...(match[7] ? { timeZone: "Etc/UTC" } : {}),
  };
};

const durationMinutes = (start: string, end?: string, duration?: string): number => {
  if (duration) {
    const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
    if (match) return Math.max(1, Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
  }
  if (end) {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) return Math.max(1, Math.round((endTime - startTime) / 60_000));
  }
  return 60;
};

const calendarAddress = (value: string): string => value.replace(/^mailto:/i, "").trim().toLowerCase();

export function parseCalendarInvites(input: string, calendarId: string): ParsedCalendarInvite[] {
  const lines = unfold(input);
  const calendarMethod = lines.map(property).find((item) => item?.name === "METHOD")?.value.toUpperCase();
  const events: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") { current = []; continue; }
    if (line.toUpperCase() === "END:VEVENT") { if (current) events.push(current); current = null; continue; }
    if (current) current.push(line);
  }

  return events.flatMap((eventLines) => {
    const props = eventLines.map(property).filter((item): item is NonNullable<ReturnType<typeof property>> => Boolean(item));
    const first = (name: string) => props.find((item) => item.name === name);
    const startProp = first("DTSTART");
    const summary = first("SUMMARY")?.value;
    if (!startProp || !summary) return [];
    const parsedStart = localDateTime(startProp.value);
    if (!parsedStart) return [];
    const timeZone = startProp.params.TZID || parsedStart.timeZone;
    const endProp = first("DTEND");
    const parsedEnd = endProp ? localDateTime(endProp.value)?.start : undefined;
    const attendees = props.filter((item) => item.name === "ATTENDEE").map((item) => calendarAddress(item.value)).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const url = first("URL")?.value || first("CONFERENCE")?.value;
    return [{
      calendarId,
      title: unescapeText(summary),
      ...(first("DESCRIPTION")?.value ? { description: unescapeText(first("DESCRIPTION")!.value) } : {}),
      start: parsedStart.start,
      durationMinutes: durationMinutes(parsedStart.start, parsedEnd, first("DURATION")?.value),
      ...(first("LOCATION")?.value ? { location: unescapeText(first("LOCATION")!.value) } : {}),
      ...(url && /^https?:\/\//i.test(url) ? { meetingLink: url.trim() } : {}),
      attendees: [...new Set(attendees)],
      sendSchedulingMessages: false,
      ...(timeZone ? { timeZone } : {}),
      allDay: parsedStart.allDay,
      ...(first("UID")?.value ? { uid: first("UID")!.value.trim() } : {}),
      ...(calendarMethod ? { method: calendarMethod } : {}),
    }];
  });
}
