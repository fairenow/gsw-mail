import type { SendAttachment } from "../engine/types.js";
const escape = (s: string) =>
  s
    .replace(/[\r\0]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
function fold(line: string) {
  let result = "",
    bytes = 0;
  for (const char of line) {
    const n = Buffer.byteLength(char);
    if (bytes + n > 74) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += n;
  }
  return result;
}
export function bookingInvite(input: {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  meetingUrl: string;
}): SendAttachment {
  const content =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GSW Mail//Event Link//EN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:gsw-booking-${input.id}`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(input.start)}`,
      `DTEND:${stamp(input.end)}`,
      `SUMMARY:${escape(input.title)}`,
      `LOCATION:${escape(input.location)}`,
      `DESCRIPTION:${escape(input.meetingUrl ? `Join: ${input.meetingUrl}` : "Booked through GSW Mail")}`,
      ...(input.meetingUrl
        ? [`URL:${input.meetingUrl.replace(/[\r\n\0]/g, "")}`]
        : []),
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n";
  return {
    filename: "booking.ics",
    contentType: "text/calendar; method=PUBLISH; charset=UTF-8",
    content: Buffer.from(content).toString("base64"),
    size: Buffer.byteLength(content),
    contentDisposition: "attachment",
  };
}
