import assert from "node:assert/strict";
import test from "node:test";
import { provisionControlPlaneUser } from "./provision.js";
import { mailAccountMemberships, organizationMemberships, organizations } from "../db/schema.js";

function selectionQueue(initial: unknown[][]) {
  const selections = [...initial];
  return {
    push(...rows: unknown[][]) { selections.push(...rows); },
    select() {
      const rows = selections.shift() ?? [];
      const query = Object.assign(Promise.resolve(rows), { limit: async () => rows });
      return { from: () => ({ where: () => query }) };
    },
  };
}

test("migrated mailbox resolves its existing product identity without promoting workspace membership", async () => {
  const activeUser = { id: "legacy-user", status: "active", authUserId: "mailbox-auth-id", name: "Mailbox User" };
  const ownedMailbox = { id: "existing-mailbox", workspaceId: "existing-workspace", authSetupStatus: "ready" };
  const selections = selectionQueue([
    [activeUser],
    [activeUser],
    [{ id: "existing-mailbox" }],
    [ownedMailbox],
  ]);
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    select: selections.select,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return { onConflictDoNothing: async () => undefined };
    } }),
  };
  const database = { transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof provisionControlPlaneUser>[3];

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) selections.push([activeUser], [activeUser], [{ id: "existing-mailbox" }], [ownedMailbox]);
    assert.deepEqual(await provisionControlPlaneUser("mailbox-auth-id", "mail@example.com", undefined, database), { id: "legacy-user", email: "mail@example.com" });
  }

  assert.equal(inserts.some((entry) => entry.table === organizations), false);
  assert.ok(inserts.filter((entry) => entry.table === organizationMemberships).every((entry) => entry.values.role === "member" && entry.values.userId === "legacy-user"));
  assert.ok(inserts.filter((entry) => entry.table === mailAccountMemberships).every((entry) => entry.values.accountId === "existing-mailbox" && entry.values.authUserId === "mailbox-auth-id"));
});

test("inactive migrated identity cannot be provisioned or gain membership", async () => {
  const disabledUser = { id: "legacy-user", status: "disabled", authUserId: "mailbox-auth-id" };
  const selections = selectionQueue([
    [disabledUser],
    [disabledUser],
    [{ id: "existing-mailbox" }],
  ]);
  const tx = {
    select: selections.select,
    update: () => { assert.fail("must not update inactive user"); },
    insert: () => { assert.fail("must not create membership for inactive user"); },
  };
  const database = { transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof provisionControlPlaneUser>[3];
  await assert.rejects(provisionControlPlaneUser("mailbox-auth-id", "mail@example.com", undefined, database), /account linkage unavailable/);
});

test("fresh Better Auth row reconnects to one same-email mailbox owner", async () => {
  const freshUser = { id: "better-auth-mailbox-auth-id", status: "active", authUserId: "mailbox-auth-id", name: "Mailbox User" };
  const legacyUser = { id: "legacy-user", status: "active", authUserId: null, name: "Mailbox User" };
  const ownedMailbox = { id: "existing-mailbox", workspaceId: "existing-workspace", authSetupStatus: "ready" };
  const selections = selectionQueue([
    [freshUser],
    [freshUser, legacyUser],
    [],
    [],
    [{ id: "existing-mailbox" }],
    [ownedMailbox],
  ]);
  const updates: unknown[] = [];
  const tx = {
    select: selections.select,
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table, values }); } }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
  };
  const database = { transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof provisionControlPlaneUser>[3];

  assert.deepEqual(await provisionControlPlaneUser("mailbox-auth-id", "mail@example.com", undefined, database), { id: "legacy-user", email: "mail@example.com" });
  assert.ok(updates.some((entry) => (entry as { values?: { authUserId?: unknown } }).values?.authUserId === null));
  assert.ok(updates.some((entry) => (entry as { values?: { authUserId?: unknown } }).values?.authUserId === "mailbox-auth-id"));
});
