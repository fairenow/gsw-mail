import test from "node:test";
import assert from "node:assert/strict";
import { StalwartEngine } from "./stalwart.js";
const from = "2026-11-01T00:00:00Z",
  until = "2026-12-01T00:00:00Z";
function createEngine(
  events: Record<string, unknown>[],
  options: {
    missing?: boolean;
    total?: number;
    stateChanges?: boolean;
    error?: string;
  } = {},
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
      const query = body.methodCalls[0]![1],
        get = body.methodCalls[1]![1];
      assert.equal(query.expandRecurrences, true);
      assert.equal(query.timeZone, "Etc/UTC");
      assert.ok((query.filter as { after: string; before: string }).after);
      assert.ok((query.filter as { after: string; before: string }).before);
      assert.ok((get.properties as string[]).includes("utcStart"));
      assert.ok((get.properties as string[]).includes("utcEnd"));
      assert.ok(!(get.properties as string[]).includes("recurrenceRules"));
      assert.ok(!(get.properties as string[]).includes("recurrenceOverrides"));
      if (options.error)
        return Response.json({
          methodResponses: [["error", { type: options.error }, "bookingQuery"]],
        });
      const position = Number(query.position ?? 0);
      positions.push(position);
      const page = events.slice(position, position + 200),
        ids = page.map((e) => e.id);
      return Response.json({
        methodResponses: [
          [
            "CalendarEvent/query",
            {
              ids,
              total: options.total ?? events.length,
              queryState: options.stateChanges ? String(position) : "stable",
            },
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
test("booking availability pages native expanded occurrences using provider-computed UTC times", async () => {
  const events = Array.from({ length: 201 }, (_, n) => ({
    id: "event-" + n,
    uid: "uid-" + n,
    calendarIds: { "calendar-1": true },
    title: "Private",
    utcStart: "2026-11-20T14:00:00Z",
    utcEnd: "2026-11-20T14:30:00Z",
  }));
  const { engine, positions } = createEngine(events);
  const rows = await engine.listBookingCalendarEvents(
    "owner@example.test",
    from,
    until,
  );
  assert.deepEqual(positions, [0, 200]);
  assert.equal(rows.length, 201);
  assert.equal(rows[200]?.uid, "uid-200");
  assert.equal(rows[0]?.start, "2026-11-20T14:00:00.000Z");
  assert.equal(rows[0]?.end, "2026-11-20T14:30:00.000Z");
  await assert.rejects(
    createEngine(events, {
      stateChanges: true,
    }).engine.listBookingCalendarEvents("owner@example.test", from, until),
    /changed/,
  );
});
test("all-day DST boundaries and recurring overrides preserve server-resolved instance times", async () => {
  const { engine } = createEngine([
    {
      id: "all-day",
      utcStart: "2026-11-01T04:00:00Z",
      utcEnd: "2026-11-02T05:00:00Z",
    },
    {
      id: "series~override",
      uid: "series",
      utcStart: "2026-11-20T16:00:00Z",
      utcEnd: "2026-11-20T16:45:00Z",
    },
  ]);
  const [event, override] = await engine.listBookingCalendarEvents(
    "owner@example.test",
    from,
    until,
  );
  assert.equal(event?.start, "2026-11-01T04:00:00.000Z");
  assert.equal(event?.end, "2026-11-02T05:00:00.000Z");
  assert.equal(override?.engineId, "series~override");
  assert.equal(override?.start, "2026-11-20T16:00:00.000Z");
});
test("incomplete responses, recurrence expansion failures and invalid times fail closed", async () => {
  const event = {
    id: "event",
    utcStart: "2026-11-20T09:00:00Z",
    utcEnd: "2026-11-20T09:30:00Z",
  };
  await assert.rejects(
    createEngine([event], { missing: true }).engine.listBookingCalendarEvents(
      "owner@example.test",
      from,
      until,
    ),
    /fully verified/,
  );
  await assert.rejects(
    createEngine([event], {
      error: "cannotCalculateOccurrences",
    }).engine.listBookingCalendarEvents("owner@example.test", from, until),
  );
  await assert.rejects(
    createEngine([
      { ...event, utcEnd: undefined },
    ]).engine.listBookingCalendarEvents("owner@example.test", from, until),
    /times/,
  );
  assert.deepEqual(
    await createEngine([
      { ...event, status: "cancelled" },
      { ...event, freeBusyStatus: "free" },
    ]).engine.listBookingCalendarEvents("owner@example.test", from, until),
    [],
  );
});
