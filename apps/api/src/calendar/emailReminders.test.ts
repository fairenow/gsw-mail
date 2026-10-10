import { describe, expect, it, vi } from "vitest";
vi.mock("../db/client.js", () => ({ pool: { connect: vi.fn(), query: vi.fn() } }));
vi.mock("../outbound/relay.js", () => ({ getRelay: vi.fn() }));
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

describe("reminder delivery safeguards", () => {
  it("refuses to treat a null relay as successful email delivery", async () => {
    const { getRelay } = await import("../outbound/relay.js");
    const { deliverDueCalendarEmailReminders } = await import("./emailReminders.js");
    vi.mocked(getRelay).mockReturnValue({name:"null",send:vi.fn().mockResolvedValue({accepted:true})});
    await expect(deliverDueCalendarEmailReminders()).rejects.toThrow("configured outbound relay");
  });
  it("does not send when there are no due reminders", async () => {
    const { getRelay } = await import("../outbound/relay.js");
    const { pool } = await import("../db/client.js");
    const { deliverDueCalendarEmailReminders } = await import("./emailReminders.js");
    const send = vi.fn();
    vi.mocked(getRelay).mockReturnValue({name:"test-relay",send});
    const query = vi.fn().mockResolvedValue({rows:[]});
    vi.mocked(pool.connect).mockResolvedValue({query,release:vi.fn()} as never);
    vi.mocked(pool.query).mockResolvedValue({rows:[]} as never);
    expect(await deliverDueCalendarEmailReminders()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
