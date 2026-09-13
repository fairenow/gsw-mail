import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveOrProvisionUser } from "./middleware.js";

test("existing authenticated users do not run provisioning", async () => {
  let provisions = 0;
  const result = await resolveOrProvisionUser("stalwart", "alyssa@example.com", {
    resolve: async () => ({ id: "user-1", email: "alyssa@example.com" }),
    provision: async () => {
      provisions += 1;
      return { id: "user-1", email: "alyssa@example.com" };
    },
  });
  assert.deepEqual(result, { user: { id: "user-1", email: "alyssa@example.com" }, provisioned: false });
  assert.equal(provisions, 0);
});

test("unknown authenticated users are provisioned once", async () => {
  let provisions = 0;
  const result = await resolveOrProvisionUser("stalwart", "new@example.com", {
    resolve: async () => null,
    provision: async () => {
      provisions += 1;
      return { id: "user-2", email: "new@example.com" };
    },
  });
  assert.deepEqual(result, { user: { id: "user-2", email: "new@example.com" }, provisioned: true });
  assert.equal(provisions, 1);
});
