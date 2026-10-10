import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EMAIL_REMINDERS, reminderDueAt } from "./emailReminders.js";

test("calendar email reminders default to 24 hours and 30 minutes", () => {
  assert.deepEqual([...DEFAULT_EMAIL_REMINDERS], [1440, 30]);
});
test("calendar email reminder due times respect the event offset", () => {
  assert.equal(reminderDueAt("2026-10-17T09:00:00-04:00",1440).toISOString(),"2026-10-16T13:00:00.000Z");
  assert.equal(reminderDueAt("2026-10-17T09:00:00-04:00",30).toISOString(),"2026-10-17T12:30:00.000Z");
});
test("calendar email reminder schedules reject invalid input", () => {
  assert.throws(() => reminderDueAt("invalid",30));
  assert.throws(() => reminderDueAt("2026-10-17T13:00:00Z",0));
  assert.throws(() => reminderDueAt("2026-10-17T13:00:00Z",10081));
});
