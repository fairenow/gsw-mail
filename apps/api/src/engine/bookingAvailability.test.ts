import test from "node:test";
import assert from "node:assert/strict";
import { StalwartEngine } from "./stalwart.js";
function createEngine(
  events: Record<string, unknown>[],
  options: { missing?: boolean; total?: number } = {},
) {
  const positions: number[] = [];
  const engine = new StalwartEngine({
    jmapUrl: "https://mail.example.test",
    accessToken: "user-token",
    sessionTtlMs: 60000,
    fetchImpl: async (_url, init) => {
      if (init?.method === "GET")
        return Response.json({
          apiUrl: "https://mail.example.test/jmap",
          accounts: {
            "account-1": {
              name: "owner@example.test",
              isPrimary: true,
              accountCapabilities: {},
            },
          },
          primaryAccounts: {},
        });
      const body = JSON.parse(String(init?.body)) as {
        methodCalls: [string, Record<string, unknown>, string][];
      };
      const position = Number(body.methodCalls[0]?.[1].position ?? 0);
      positions.push(position);
      const page = events.slice(position, position + 200),
        ids = page.map((e) => e.id);
      return Response.json({
        methodResponses: [
          [
            "CalendarEvent/query",
            { ids, total: options.total ?? events.length },
            "bookingQuery",
          ],
          [
            "CalendarEvent/get",
            {
              list: options.missing ? page.slice(1) : page,
              notFound: options.missing ? ["missing"] : [],
            },
            "bookingGet",
          ],
        ],
      });
    },
  });
  return { engine, positions };
}
test("booking availability scans beyond the first 200 events and normalizes mailbox timezone", async () => {
  const events = Array.from({ length: 201 }, (_, n) => ({
    id: "event-" + n,
    uid: "uid-" + n,
    calendarIds: { "calendar-1": true },
    title: "Private",
    start: "2026-11-20T09:00:00",
    timeZone: "America/Detroit",
    duration: "PT30M",
    recurrenceRules: [],
    recurrenceOverrides: {},
  }));
  const { engine, positions } = createEngine(events);
  const rows = await engine.listBookingCalendarEvents(
    "owner@example.test",
    "2026-11-01T00:00:00Z",
    "2026-12-01T00:00:00Z",
  );
  assert.deepEqual(positions, [0, 200]);
  assert.equal(rows.length, 201);
  assert.equal(rows[200]?.uid, "uid-200");
  assert.equal(rows[0]?.start, "2026-11-20T14:00:00.000Z");
  assert.equal(rows[0]?.end, "2026-11-20T14:30:00.000Z");
});
test("all-day busy intervals cross daylight-saving boundaries using calendar days", async () => {
  const { engine } = createEngine([
    {
      id: "all-day",
      start: "2026-11-01T00:00:00",
      timeZone: "America/Detroit",
      duration: "P1D",
      showWithoutTime: true,
    },
  ]);
  const [event] = await engine.listBookingCalendarEvents(
    "owner@example.test",
    "",
    "",
  );
  assert.equal(event?.start, "2026-11-01T04:00:00.000Z");
  assert.equal(event?.end, "2026-11-02T05:00:00.000Z");
});
test("partial, recurring, and unknown-duration calendars fail closed; cancelled/free events do not block", async () => {
  const event = {
    id: "event",
    start: "2026-11-20T09:00:00",
    timeZone: "UTC",
    duration: "PT30M",
  };
  await assert.rejects(
    createEngine([event], { missing: true }).engine.listBookingCalendarEvents(
      "owner@example.test",
      "",
      "",
    ),
    /fully verified/,
  );
  await assert.rejects(
    createEngine([
      { ...event, recurrenceRules: [{ frequency: "weekly" }] },
    ]).engine.listBookingCalendarEvents("owner@example.test", "", ""),
    /Recurring/,
  );
  await assert.rejects(
    createEngine([
      { ...event, duration: undefined },
    ]).engine.listBookingCalendarEvents("owner@example.test", "", ""),
    /duration/,
  );
  assert.deepEqual(
    await createEngine([
      { ...event, status: "cancelled" },
      { ...event, freeBusyStatus: "free" },
    ]).engine.listBookingCalendarEvents("owner@example.test", "", ""),
    [],
  );
});
