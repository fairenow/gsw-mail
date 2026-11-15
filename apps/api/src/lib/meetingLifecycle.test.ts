import test from "node:test";
import assert from "node:assert/strict";
import { operatorMeetingAccess } from "../meetings/access.js";
import { meetingStartUtc, partnerMeetingId } from "../meetings/calendarSync.js";
test("operator meetings require the authenticated founder, active owner membership and explicit exemption", () => {
  const row = {
    email: "24hrautollc@gmail.com",
    authenticated: true,
    active: true,
    owner: true,
    exempt: true,
  };
  assert.equal(operatorMeetingAccess(row), true);
  for (const key of ["authenticated", "active", "owner", "exempt"] as const)
    assert.equal(operatorMeetingAccess({ ...row, [key]: false }), false);
  assert.equal(
    operatorMeetingAccess({ ...row, email: "other@example.com" }),
    false,
  );
  assert.equal(operatorMeetingAccess(undefined), false);
});
test("meeting schedule preserves the event timezone across standard and daylight time", () => {
  assert.equal(
    meetingStartUtc("2026-11-20T15:00:00", "America/Detroit"),
    "2026-11-20T20:00:00.000Z",
  );
  assert.equal(
    meetingStartUtc("2026-07-20T15:00:00", "America/Detroit"),
    "2026-07-20T19:00:00.000Z",
  );
  assert.equal(
    meetingStartUtc("2026-11-20T15:00:00Z", "America/Detroit"),
    "2026-11-20T15:00:00.000Z",
  );
  assert.throws(() =>
    meetingStartUtc("2026-03-08T02:30:00", "America/Detroit"),
  );
});
test("only canonical partner meeting URLs are synchronized", () => {
  const origin = "https://bible.example.com";
  assert.equal(
    partnerMeetingId(origin + "/meet/meeting-1", origin),
    "meeting-1",
  );
  for (const link of [
    "https://evil.example/meet/meeting-1",
    origin + "/meet/meeting-1?host=secret",
    origin + "/live/meeting-1",
    "https://user:secret@bible.example.com/meet/meeting-1",
  ])
    assert.equal(partnerMeetingId(link, origin), null);
});

test("operator entitlement SQL respects the real user_status column and workspace ownership", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { OPERATOR_MEETING_QUERY } = await import("../meetings/access.js");
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE users(id text,email text,auth_user_id text,user_status text); CREATE TABLE organization_memberships(user_id text,organization_id text,org_membership_role text,org_membership_status text); CREATE TABLE billing_mailbox_exemptions(organization_id text,reason text);",
    );
    await db.exec(
      "INSERT INTO users VALUES('founder','24hrautollc@gmail.com','auth-1','active'); INSERT INTO organization_memberships VALUES('founder','workspace','owner','active'); INSERT INTO billing_mailbox_exemptions VALUES('workspace','founder_operator_exception');",
    );
    const result = await db.query<{
      email: string;
      authenticated: boolean;
      active: boolean;
      owner: boolean;
      exempt: boolean;
    }>(OPERATOR_MEETING_QUERY, ["founder", "workspace"]);
    assert.equal(operatorMeetingAccess(result.rows[0]), true);
    const other = await db.query<{
      email: string;
      authenticated: boolean;
      active: boolean;
      owner: boolean;
      exempt: boolean;
    }>(OPERATOR_MEETING_QUERY, ["founder", "other-workspace"]);
    assert.equal(operatorMeetingAccess(other.rows[0]), false);
  } finally {
    await db.close();
  }
});
