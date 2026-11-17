import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pool } from "../db/client.js";
import { HOST_CODE_SCHEMA, createOwnerCode, redeemOwnerCode, bookingOwnerCode } from "../meetings/ownerCode.js";

test("organizer codes preserve leading digits, isolate owners, and enforce atomic attempt, expiry and consumption limits", async () => {
  const db = new PGlite();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const secret = process.env.GSW_MEETINGS_SIGNING_SECRET;
  const origin = process.env.GSW_MEETINGS_WEB_ORIGIN;
  process.env.GSW_MEETINGS_SIGNING_SECRET = "test-only-meeting-signing-secret-32-bytes";
  process.env.GSW_MEETINGS_WEB_ORIGIN = "https://meet.example.test";
  const query = (sql: string, params?: unknown[]) => db.query(sql, params);
  pool.query = query as unknown as typeof pool.query;
  pool.connect = (async () => ({ query, release() {} })) as unknown as typeof pool.connect;
  const account = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec("CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE email_accounts(id uuid PRIMARY KEY); INSERT INTO users VALUES('owner'),('other'); INSERT INTO email_accounts VALUES('" + account + "'),('" + other + "');");
    await db.exec(HOST_CODE_SCHEMA);
    const generated = await createOwnerCode("meeting", account, "owner", new Date().toISOString());
    assert.match(generated.ownerCode, /^[0-9]{8}$/);
    assert.equal((await createOwnerCode("meeting", account, "owner", new Date().toISOString())).ownerCode, generated.ownerCode);
    await assert.rejects(createOwnerCode("meeting", other, "other", new Date().toISOString()));
    assert.equal(await bookingOwnerCode("https://meet.example.test/meet/meeting", other, "other"), undefined);
    assert.equal(await bookingOwnerCode("https://meet.example.test/meet/meeting", account, "owner"), generated.ownerCode);
    const wrong = (generated.ownerCode[0] === "0" ? "1" : "0") + generated.ownerCode.slice(1);
    for (let attempt = 0; attempt < 10; attempt++) assert.equal(await redeemOwnerCode("meeting", wrong), null);
    assert.equal(await redeemOwnerCode("meeting", generated.ownerCode), null);
    assert.equal((await db.query<{ attempts: number }>("SELECT attempts FROM meeting_owner_codes")).rows[0]!.attempts, 10);
    await db.exec("UPDATE meeting_owner_codes SET attempts=0,expires_at=now()-interval '1 second'");
    assert.equal(await redeemOwnerCode("meeting", generated.ownerCode), null);
    await db.exec("UPDATE meeting_owner_codes SET expires_at=now()+interval '1 day',consumed_at=now()");
    assert.equal(await redeemOwnerCode("meeting", generated.ownerCode), null);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (secret === undefined) delete process.env.GSW_MEETINGS_SIGNING_SECRET; else process.env.GSW_MEETINGS_SIGNING_SECRET = secret;
    if (origin === undefined) delete process.env.GSW_MEETINGS_WEB_ORIGIN; else process.env.GSW_MEETINGS_WEB_ORIGIN = origin;
    await db.close();
  }
});
