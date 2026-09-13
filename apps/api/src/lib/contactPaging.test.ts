import { strict as assert } from "node:assert";
import { test } from "node:test";
import { paginateContacts } from "./contactPaging.js";

test("paginates contact lists beyond the old 50 and 500 row caps", () => {
  const contacts = Array.from({ length: 693 }, (_, index) => `contact-${index + 1}`);
  const first = paginateContacts(contacts, 100, 0);
  const sixth = paginateContacts(contacts, 100, 500);
  const last = paginateContacts(contacts, 100, 600);
  assert.equal(first.total, 693);
  assert.equal(first.contacts.length, 100);
  assert.equal(sixth.contacts[0], "contact-501");
  assert.equal(last.contacts.length, 93);
  assert.equal(last.contacts.at(-1), "contact-693");
});
