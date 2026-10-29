import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkspaceUserDeletion } from "./adminDeletionPolicy.js";
const member = { actorId:"actor", actorRole:"admin", targetId:"target", targetRole:"member", ownsMailboxes:false, email:"user@example.com", confirmation:"user@example.com" };
test("admin deletion protects owners, self, other admins and owned mailboxes", () => {
  for (const patch of [{targetRole:"owner"},{targetId:"actor"},{targetRole:"admin"},{ownsMailboxes:true},{confirmation:"another@example.com"},{actorRole:"member"}]) assert.throws(() => assertWorkspaceUserDeletion({...member,...patch}));
});
test("admins may remove members and owners may remove other admins", () => {
  assert.doesNotThrow(() => assertWorkspaceUserDeletion(member));
  assert.doesNotThrow(() => assertWorkspaceUserDeletion({...member,actorRole:"owner",targetRole:"admin"}));
});
