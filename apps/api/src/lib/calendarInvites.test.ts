import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseCalendarInvites } from "./calendarInvites.js";

test("parses a standard email calendar invitation", () => {
  const [event] = parseCalendarInvites(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:meeting-123@example.com\r\nDTSTART;TZID=America/Detroit:20260924T133000\r\nDTEND;TZID=America/Detroit:20260924T143000\r\nSUMMARY:Strategy Meeting\r\nDESCRIPTION:Review the next steps\\nBring notes\r\nLOCATION:Conference Room A\r\nURL:https://meet.example.com/abc\r\nATTENDEE;CN=Guest:mailto:guest@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR`, "calendar-1");
  assert.ok(event);
  assert.equal(event.calendarId, "calendar-1");
  assert.equal(event.title, "Strategy Meeting");
  assert.equal(event.start, "2026-09-24T13:30:00");
  assert.equal(event.durationMinutes, 60);
  assert.equal(event.timeZone, "America/Detroit");
  assert.equal(event.location, "Conference Room A");
  assert.equal(event.meetingLink, "https://meet.example.com/abc");
  assert.deepEqual(event.attendees, ["guest@example.com"]);
  assert.equal(event.method, "REQUEST");
});

test("parses all-day invitations", () => {
  const [event] = parseCalendarInvites(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:holiday-1\nDTSTART;VALUE=DATE:20261225\nDTEND;VALUE=DATE:20261226\nSUMMARY:Christmas Day\nEND:VEVENT\nEND:VCALENDAR`, "calendar-1");
  assert.ok(event);
  assert.equal(event.start, "2026-12-25T00:00:00");
  assert.equal(event.allDay, true);
  assert.equal(event.durationMinutes, 1440);
});
