import test from "node:test";
import assert from "node:assert/strict";
import { computeNextAutomationRun, type AutomationSchedule } from "./automationSchedule.js";

const schedule: AutomationSchedule = { frequency: "hourly", hour: 0, minute: 15 };
test("hourly schedule selects the next local quarter hour", () => {
  assert.equal(computeNextAutomationRun(schedule, "UTC", new Date("2026-10-09T14:20:00.000Z"))?.toISOString(), "2026-10-09T15:15:00.000Z");
  assert.equal(computeNextAutomationRun(schedule, "UTC", new Date("2026-10-09T23:30:00.000Z"))?.toISOString(), "2026-10-10T00:15:00.000Z");
});
test("every three hours uses the configured anchor hour", () => {
  const everyThree: AutomationSchedule = { frequency: "hourly", hour: 2, minute: 30, interval: 3 };
  assert.equal(computeNextAutomationRun(everyThree, "UTC", new Date("2026-10-09T08:35:00.000Z"))?.toISOString(), "2026-10-09T11:30:00.000Z");
});
test("hourly schedules respect local timezone and spring daylight saving gap", () => {
  const next = computeNextAutomationRun({ frequency: "hourly", hour: 0, minute: 30 }, "America/New_York", new Date("2026-03-08T06:45:00.000Z"));
  assert.equal(next?.toISOString(), "2026-03-08T07:30:00.000Z");
});
test("hourly recurrence rejects intervals over 24 hours", () => {
  assert.equal(computeNextAutomationRun({ ...schedule, interval: 25 }, "UTC"), null);
});
