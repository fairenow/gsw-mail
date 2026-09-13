import assert from "node:assert/strict";
import test from "node:test";
import { provisionControlPlaneUser } from "./provision.js";
import { mailAccountMemberships, organizationMemberships, organizations } from "../db/schema.js";

test("migrated mailbox resolves its existing product identity without promoting workspace membership", async () => {
  const selections = [
    [{ id: "legacy-user" }],
    [{ id: "legacy-user", status: "active" }],
    [{ id: "existing-mailbox", workspaceId: "existing-workspace", authSetupStatus: "ready" }],
  ];
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    select: () => {
      const rows = selections.shift();
      return { from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) };
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return { onConflictDoNothing: async () => undefined };
    } }),
  };
  const database = { transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof provisionControlPlaneUser>[3];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) selections.push([{ id: "legacy-user" }], [{ id: "legacy-user", status: "active" }], [{ id: "existing-mailbox", workspaceId: "existing-workspace", authSetupStatus: "ready" }]);
    assert.deepEqual(await provisionControlPlaneUser("mailbox-auth-id", "mail@example.com", undefined, database), { id: "legacy-user", email: "mail@example.com" });
  }
  assert.equal(inserts.some((entry) => entry.table === organizations), false);
  assert.ok(inserts.filter((entry) => entry.table === organizationMemberships).every((entry) => entry.values.role === "member" && entry.values.userId === "legacy-user"));
  assert.ok(inserts.filter((entry) => entry.table === mailAccountMemberships).every((entry) => entry.values.accountId === "existing-mailbox" && entry.values.authUserId === "mailbox-auth-id"));
});

test("inactive migrated identity cannot be provisioned or gain membership", async () => {
  const selections = [[{ id: "legacy-user" }], [{ id: "legacy-user", status: "disabled" }]];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selections.shift() }) }) }),
    update: () => { assert.fail("must not update inactive user"); },
    insert: () => { assert.fail("must not create membership for inactive user"); },
  };
  const database = { transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(tx) } as unknown as Parameters<typeof provisionControlPlaneUser>[3];
  await assert.rejects(provisionControlPlaneUser("mailbox-auth-id", "mail@example.com", undefined, database), /account linkage unavailable/);
});
