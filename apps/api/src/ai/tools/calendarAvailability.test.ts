import test from "node:test";
import assert from "node:assert/strict";
import { calculateFreeSlots, computeCalendarConflicts } from "./calendarAvailability.js";

const events = [
  { engineId: "a", calendarIds: ["main"], title: "A", start: "2026-10-09T13:00:00.000Z", end: "2026-10-09T13:30:00.000Z", attendees: [], allDay: false },
  { engineId: "b", calendarIds: ["main"], title: "B", start: "2026-10-09T14:00:00.000Z", end: "2026-10-09T15:00:00.000Z", attendees: [], allDay: false },
];
test("finds overlapping events using half-open intervals", () => {
  assert.deepEqual(computeCalendarConflicts(events, "2026-10-09T13:30:00.000Z", "2026-10-09T14:00:00.000Z"), []);
  assert.equal(computeCalendarConflicts(events, "2026-10-09T13:45:00.000Z", "2026-10-09T14:15:00.000Z").length, 1);
  assert.deepEqual(computeCalendarConflicts(events, "2026-10-09T14:00:00.000Z", "2026-10-09T15:00:00.000Z", "b"), []);
});
test("calculates free windows meeting requested duration", () => {
  assert.deepEqual(calculateFreeSlots(events, "2026-10-09T12:00:00.000Z", "2026-10-09T16:00:00.000Z", 30), [
    { start: "2026-10-09T12:00:00.000Z", end: "2026-10-09T13:00:00.000Z" },
    { start: "2026-10-09T13:30:00.000Z", end: "2026-10-09T14:00:00.000Z" },
    { start: "2026-10-09T15:00:00.000Z", end: "2026-10-09T16:00:00.000Z" },
  ]);
});
