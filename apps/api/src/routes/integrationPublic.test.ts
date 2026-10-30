import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import integrationPublic from "./integrationPublic.js";
import integrationApi from "./integrationApi.js";

test("public API entry points expose guidance and schemas without opening private mailbox routes", async () => {
  const app = Fastify();
  try {
    await app.register(integrationPublic);
    await app.register(integrationApi);
    for (const url of ["/integrations/v1", "/integrations/v1/"]) {
      const result = await app.inject({ url });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().documentation, "https://mail-docs.guidedstepswellness.com");
      assert.match(result.json().authentication, /Bearer/);
    }
    const reference = await app.inject({ url: "/integrations/v1/reference" });
    assert.equal(reference.statusCode, 200);
    const operations = reference.json().operations as { name: string; inputSchema: unknown }[];
    assert.ok(operations.length > 20);
    assert.ok(operations.every(op => op.inputSchema));
    assert.ok(!operations.some(op => /^(admin|domain|workspace|mailbox_admin|alias)\./.test(op.name)));
    for (const url of ["/integrations/v1/capabilities", "/integrations/v1/connection"]) {
      const response = await app.inject({ url });
      assert.equal(response.statusCode, 401);
      assert.match(String(response.headers["www-authenticate"]), /Bearer/);
      assert.match(String(response.headers.link), /mail-docs/);
    }
    const write = await app.inject({ method: "POST", url: "/integrations/v1/operations", payload: { name: "mail.list_recent", arguments: { limit: 1 } } });
    assert.equal(write.statusCode, 401);
  } finally {
    await app.close();
  }
});
