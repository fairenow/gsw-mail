import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_REMINDERS, reminderDueAt } from "./emailReminders.js";

describe("calendar email reminder scheduling", () => {
  it("defaults to 24 hours and 30 minutes", () => {
    expect(DEFAULT_EMAIL_REMINDERS).toEqual([1440, 30]);
  });
  it("calculates both default reminder times in UTC", () => {
    expect(reminderDueAt("2026-10-17T09:00:00-04:00", 1440).toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(reminderDueAt("2026-10-17T09:00:00-04:00", 30).toISOString()).toBe("2026-10-17T12:30:00.000Z");
  });
  it("rejects invalid intervals and event dates", () => {
    expect(() => reminderDueAt("not-a-date", 30)).toThrow();
    expect(() => reminderDueAt("2026-10-17T13:00:00Z", 0)).toThrow();
    expect(() => reminderDueAt("2026-10-17T13:00:00Z", 10081)).toThrow();
  });
});
