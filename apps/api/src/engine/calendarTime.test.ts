import test from "node:test";
import assert from "node:assert/strict";
import { StalwartEngine } from "./stalwart.js";
test("calendar listing returns real instants for booked UTC and local-zone meetings while preserving all-day dates", async () => {
  const raw = [
    { id: "booked", start: "2026-11-16T15:50:00", timeZone: "Etc/UTC", duration: "PT30M" },
    { id: "local", start: "2026-11-16T10:50:00", timeZone: "America/Detroit", duration: "PT30M" },
    { id: "summer", start: "2026-07-16T10:50:00", timeZone: "America/Detroit", duration: "PT30M" },
    { id: "all-day", start: "2026-11-16T00:00:00", timeZone: "America/Detroit", duration: "P1D", showWithoutTime: true },
  ];
  const engine = new StalwartEngine({ jmapUrl: "https://mail.example.test", accessToken: "test-token", fetchImpl: async (_url, init) => {
    if (init?.method === "GET") return Response.json({ apiUrl: "https://mail.example.test/jmap", accounts: { a: { name: "owner@example.test", isPrimary: true, accountCapabilities: {} } }, primaryAccounts: {} });
    const body = JSON.parse(String(init?.body)) as { methodCalls: [string, unknown, string][] };
    return Response.json({ methodResponses: body.methodCalls.map(([method, _args, id]) => [method, method.endsWith("/query") ? { ids: raw.map(e => e.id) } : { list: raw }, id]) });
  } });
  const events = await engine.listCalendarEvents("owner@example.test", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
  assert.equal(events[0]?.start, "2026-11-16T15:50:00.000Z");
  assert.equal(events[0]?.end, "2026-11-16T16:20:00.000Z");
  assert.equal(events[1]?.start, events[0]?.start);
  assert.equal(events[2]?.start, "2026-07-16T14:50:00.000Z");
  assert.equal(events[3]?.start, "2026-11-16T00:00:00");
});
