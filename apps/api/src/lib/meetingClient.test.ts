import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { jwtVerify } from "jose";
import { createMeetingClient } from "../meetings/client.js";

const config = { apiUrl: "https://meetings.example.com", webOrigin: "https://bible.example.com", signingSecret: "a".repeat(32) };
const input = { externalEventId: "draft-1", title: "Planning", scheduledAt: "2026-11-20T15:00:00Z", timezone: "America/Detroit" };
const organizer = { userId: "user-1", workspaceId: "workspace-1" };
const room = { meetingId: "room-1", joinUrl: "https://bible.example.com/meet/room-1", status: "scheduled" };

test("meeting request binds trusted identity and exact payload with expiring unique assertions", async () => {
  const ids = new Set();
  const client = createMeetingClient(config, async (url, init) => {
    assert.equal(url, "https://meetings.example.com/integrations/gsw-mail/rooms");
    assert.equal(init?.redirect, "error");
    const token = new Headers(init?.headers).get("authorization")!.slice(7);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.signingSecret), {
      issuer: "gsw-mail", audience: "bible-study-meetings", algorithms: ["HS256"],
    });
    assert.equal(payload.sub, organizer.userId);
    assert.equal(payload.workspaceId, organizer.workspaceId);
    assert.equal(payload.operation, "rooms.create");
    assert.equal(payload.bodySha256, createHash("sha256").update(String(init?.body)).digest("hex"));
    assert.equal(payload.exp! - payload.iat!, 60);
    ids.add(payload.jti);
    return Response.json(room);
  });
  assert.deepEqual(await client.createRoom(organizer, input), room);
  await client.createRoom(organizer, input);
  assert.equal(ids.size, 2);
});

test("rejects broadcast fields and invalid scheduling before calling provider", async () => {
  const client = createMeetingClient(config, async () => { throw new Error("must not call provider"); });
  await assert.rejects(client.createRoom(organizer, { ...input, public: true } as typeof input));
  await assert.rejects(client.createRoom(organizer, { ...input, timezone: "invalid" }));
});

test("rejects foreign origins, embedded credentials, query tokens and oversized replies", async () => {
  for (const joinUrl of ["https://evil.example/room", "https://user:secret@bible.example.com/room", "https://bible.example.com/room?host=secret"]) {
    const client = createMeetingClient(config, async () => Response.json({ ...room, joinUrl }));
    await assert.rejects(client.createRoom(organizer, input), /meeting_service_invalid_response/);
  }
  const client = createMeetingClient(config, async () => new Response("x".repeat(20_000)));
  await assert.rejects(client.createRoom(organizer, input), /meeting_service_invalid_response/);
});

test("provider failures never expose upstream bodies or network credentials", async () => {
  for (const status of [403, 500]) {
    const client = createMeetingClient(config, async () => new Response("private upstream diagnostics", { status }));
    await assert.rejects(client.createRoom(organizer, input), status === 403 ? /meeting_service_rejected/ : /meeting_service_unavailable/);
  }
  const client = createMeetingClient(config, async () => { throw new Error(config.signingSecret); });
  await assert.rejects(client.createRoom(organizer, input), /meeting_service_unavailable/);
});

test("rejects insecure endpoint configuration and weak secrets", () => {
  assert.throws(() => createMeetingClient({ ...config, apiUrl: "http://example.com" }));
  assert.throws(() => createMeetingClient({ ...config, signingSecret: "short" }));
});
