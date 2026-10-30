import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import Fastify from "fastify";
import type { db as productionDb } from "../db/client.js";
import { createIntegrationService } from "../integrations/service.js";
import { fingerprint, integrationSendSchema, issueIntegrationKey } from "../integrations/contract.js";
import { assertIntegrationDispatch } from "../integrations/dispatch.js";
import { claimDueJobs, retrySend } from "../outbound/queue.js";
import { integrationApi } from "./integrationApi.js";

test("integration API persists requests, isolates installations, enforces grants and never queues test sends", async t => {
  const pg = new PGlite();
  const app = Fastify();
  try {
    for (const file of ["0000_quick_falcon", "0001_add_template_key", "0006_better_auth", "0007_workspace_normalization", "0009_mailbox_auth_setup", "0041_integration_email_api"]) {
      await pg.exec(await readFile(new URL(`../../drizzle/${file}.sql`, import.meta.url), "utf8"));
    }
    const organizationId = randomUUID(), domainId = randomUUID(), accountId = randomUUID(), installationId = randomUUID(), otherInstallation = randomUUID(), keyId = randomUUID(), otherKeyId = randomUUID();
    await pg.query("INSERT INTO users(id,identity_subject,email) VALUES('admin','admin','admin@example.test')");
    await pg.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Ministry','ministry')", [organizationId]);
    await pg.query("INSERT INTO organization_memberships(organization_id,user_id,org_membership_role) VALUES($1,'admin','owner')", [organizationId]);
    await pg.query("INSERT INTO domains(id,organization_id,name,domain_status,spf_status,dkim_status,dmarc_status) VALUES($1,$2,'example.test','verified','verified','verified','verified')", [domainId, organizationId]);
    await pg.query("INSERT INTO email_accounts(id,workspace_id,domain_id,local_part,address,account_status,auth_setup_status) VALUES($1,$2,$3,'office','office@example.test','active','ready')", [accountId, organizationId, domainId]);
    for (const id of [installationId, otherInstallation]) await pg.query("INSERT INTO integration_installations(id,organization_id,account_id,authorized_by,name,allowed_recipients) VALUES($1,$2,$3,'admin','Website','[\"visitor@example.test\"]')", [id, organizationId, accountId]);
    const issued = issueIntegrationKey(), otherIssued = issueIntegrationKey();
    for (const [id, installation, key] of [[keyId, installationId, issued], [otherKeyId, otherInstallation, otherIssued]] as const) await pg.query("INSERT INTO integration_keys(id,installation_id,name,key_hash,key_prefix,scopes,expires_at) VALUES($1,$2,'Server',$3,$4,'[\"connection.read\",\"email.send\",\"email.read\"]',now()+interval '1 day')", [id, installation, key.keyHash, key.keyPrefix]);
    const service = createIntegrationService(drizzle(pg) as unknown as typeof productionDb, { liveTransportReady: () => true });
    await app.register(integrationApi, { service });
    const headers = { authorization: `Bearer ${issued.secret}`, "idempotency-key": "inquiry:1:ack:v1" };
    const payload = { senderId: accountId, to: ["visitor@example.test"], subject: "Inquiry received", text: "Thank you", metadata: { externalRecordId: "inquiry-1" } };
    const send = (body = payload, key = headers["idempotency-key"]) => app.inject({ method: "POST", url: "/integrations/v1/emails", headers: { ...headers, "idempotency-key": key }, payload: body });
    let emailId = "";
    await t.test("test mode returns a durable simulated result without creating outbound messages", async () => {
      const response = await send();
      assert.equal(response.statusCode, 202, response.body);
      emailId = response.json().id;
      assert.equal(response.json().status, "simulated");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM outbound_messages")).rows[0]!.count, 0);
      const stored = (await pg.query<{key_hash:string}>("SELECT key_hash FROM integration_keys WHERE id=$1", [keyId])).rows[0]!;
      assert.notEqual(stored.key_hash, issued.secret);
    });
    await t.test("concurrent duplicate requests return one ID and changed payload is a conflict", async () => {
      const responses = await Promise.all(Array.from({length: 5}, () => send()));
      assert.ok(responses.every(r => r.statusCode === 202 && r.json().id === emailId));
      const conflict = await send({ ...payload, text: "Different" });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, "idempotency_conflict");
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM integration_emails")).rows[0]!.count, 1);
    });
    await t.test("status is installation-scoped even for another installation on the same sender", async () => {
      assert.equal((await app.inject({url: `/integrations/v1/emails/${emailId}`, headers})).statusCode, 200);
      assert.equal((await app.inject({url: `/integrations/v1/emails/${emailId}`, headers: {authorization: `Bearer ${otherIssued.secret}`}})).statusCode, 404);
    });
    await t.test("sender, recipient, unknown fields and malformed idempotency input are rejected", async () => {
      assert.equal((await send({...payload, senderId: randomUUID()}, "wrong-sender")).statusCode, 403);
      assert.equal((await send({...payload, to: ["unapproved@example.test"]}, "wrong-recipient")).statusCode, 403);
      assert.equal((await app.inject({method: "POST",url:"/integrations/v1/emails",headers,payload:{...payload,from:"spoof@example.test"}})).statusCode,400);
      assert.equal((await send(payload, "bad key")).statusCode, 400);
      assert.equal((await send({...payload,subject:"Hello\r\nBcc: victim@example.test"}, "header-injection")).statusCode,400);
    });
    await t.test("key scopes and expiration are enforced without trusting caller principal scopes", async () => {
      await pg.query("UPDATE integration_keys SET scopes='[\"connection.read\"]' WHERE id=$1", [keyId]);
      assert.equal((await send(payload, "no-scope")).statusCode, 403);
      await pg.query("UPDATE integration_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [keyId]);
      assert.equal((await send(payload, "expired")).statusCode, 401);
      await pg.query("UPDATE integration_keys SET scopes='[\"connection.read\",\"email.send\",\"email.read\"]',expires_at=now()+interval '1 day' WHERE id=$1", [keyId]);
    });
    await t.test("daily quota blocks new work but still permits idempotent replay", async () => {
      await pg.query("UPDATE integration_installations SET daily_limit=1 WHERE id=$1", [installationId]);
      const limited = await send(payload, "over-limit");
      assert.equal(limited.statusCode, 429);
      assert.ok(Number(limited.headers["retry-after"]) > 0);
      assert.equal((await send()).statusCode, 202);
      await pg.query("UPDATE integration_installations SET daily_limit=100 WHERE id=$1", [installationId]);
    });
    await t.test("suppression and suspension take effect on the next operation", async () => {
      await pg.query("INSERT INTO delivery_suppressions(organization_id,email,suppression_reason,source) VALUES($1,'visitor@example.test','manual','test')", [organizationId]);
      assert.equal((await send(payload, "suppressed")).statusCode, 409);
      await pg.query("DELETE FROM delivery_suppressions");
      await pg.query("UPDATE organization_memberships SET org_membership_status='suspended'");
      assert.equal((await send(payload, "suspended")).statusCode, 403);
      await pg.query("UPDATE organization_memberships SET org_membership_status='active'");
      await pg.query("UPDATE integration_installations SET active=false WHERE id=$1", [installationId]);
      assert.equal((await send(payload, "paused")).statusCode, 403);
      await pg.query("UPDATE integration_installations SET active=true WHERE id=$1", [installationId]);
    });
    await t.test("live mode queues message, recipients and request atomically with no network send", async () => {
      await pg.query("UPDATE integration_installations SET test_mode=false WHERE id=$1", [installationId]);
      const response = await send(payload, "live-1");
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(response.json().testMode, false);
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM outbound_messages WHERE transport_status='queued'")).rows[0]!.count, 1);
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM outbound_recipients")).rows[0]!.count, 1);
      await pg.exec("CREATE FUNCTION reject_recipient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated persistence failure'; END $$; CREATE TRIGGER reject_recipient BEFORE INSERT ON outbound_recipients FOR EACH ROW EXECUTE FUNCTION reject_recipient();");
      assert.equal((await send(payload, "rolled-back")).statusCode, 500);
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM outbound_messages")).rows[0]!.count, 1);
      assert.equal((await pg.query<{count:number}>("SELECT count(*)::int AS count FROM integration_emails WHERE idempotency_key='rolled-back'")).rows[0]!.count, 0);
      await pg.exec("DROP TRIGGER reject_recipient ON outbound_recipients; DROP FUNCTION reject_recipient();");
    });
    await t.test("dispatch rechecks revocation, pause, DNS and suppression after queue acceptance", async () => {
      const database = drizzle(pg) as unknown as typeof productionDb;
      const [queued] = (await pg.query<{id:string}>("SELECT id FROM outbound_messages")).rows;
      const job = { id: queued!.id, accountId, fromAddress: "office@example.test", to: ["visitor@example.test"] };
      const allowed = () => assertIntegrationDispatch(job, database, service, () => true);
      assert.equal(await allowed(), true);
      await pg.query("UPDATE integration_keys SET revoked_at=now() WHERE id=$1", [keyId]);
      await assert.rejects(allowed, /invalid_api_key/);
      await pg.query("UPDATE integration_keys SET revoked_at=NULL WHERE id=$1", [keyId]);
      await pg.query("UPDATE integration_installations SET active=false WHERE id=$1", [installationId]);
      await assert.rejects(allowed, /installation_unavailable/);
      await pg.query("UPDATE integration_installations SET active=true WHERE id=$1", [installationId]);
      await pg.query("UPDATE domains SET dkim_status='failed'");
      await assert.rejects(allowed, /sender_dns_not_ready/);
      await pg.query("UPDATE domains SET dkim_status='verified'");
      await pg.query("INSERT INTO delivery_suppressions(organization_id,email,suppression_reason,source) VALUES($1,'visitor@example.test','manual','test')", [organizationId]);
      await assert.rejects(allowed, /recipient_suppressed/);
      await pg.query("DELETE FROM delivery_suppressions");
      assert.equal(await allowed(), true);
      assert.equal(await assertIntegrationDispatch({...job,id:randomUUID()},database,service,()=>true),false);
    });
    await t.test("expired integration dispatch leases are quarantined and cannot use ordinary mailbox retry", async () => {
      await pg.query("UPDATE outbound_messages SET transport_status='sending',updated_at=now()-interval '10 minutes'");
      const legacyId = randomUUID();
      await pg.query(`INSERT INTO outbound_messages(id,account_id,from_address,"to",transport_status,updated_at) VALUES($1,$2,'office@example.test','["visitor@example.test"]','sending',now()-interval '10 minutes')`, [legacyId, accountId]);
      const database = drizzle(pg) as unknown as typeof productionDb;
      const claimed = await claimDueJobs(10, database);
      assert.deepEqual(claimed.map(row => row.id), [legacyId]);
      const quarantined = (await pg.query<{id:string;failure_code:string}>("SELECT id,failure_code FROM outbound_messages WHERE id<>$1", [legacyId])).rows[0]!;
      assert.equal(quarantined.failure_code, "submission_unknown");
      assert.equal(await retrySend(quarantined.id, database), false);
    });
    await t.test("revoked keys are rejected and hashes or secrets never appear in connection responses", async () => {
      const connection = await app.inject({url:"/integrations/v1/connection",headers});
      assert.equal(connection.statusCode,200);
      assert.ok(!connection.body.includes(issued.secret) && !connection.body.includes(issued.keyHash));
      await pg.query("UPDATE integration_keys SET revoked_at=now() WHERE id=$1", [keyId]);
      assert.equal((await send()).statusCode,401);
    });
  } finally {
    await app.close(); await pg.close();
  }
});

test("fingerprint ignores metadata key ordering and strict parsing normalizes email addresses", () => {
  const input = {senderId:randomUUID(),to:["VISITOR@example.test"],subject:"Hello",text:"Welcome",metadata:{b:"2",a:"1"}};
  const parsed = integrationSendSchema.parse(input);
  assert.deepEqual(parsed.to,["visitor@example.test"]);
  assert.equal(fingerprint(parsed),fingerprint({...parsed,metadata:{a:"1",b:"2"}}));
});
