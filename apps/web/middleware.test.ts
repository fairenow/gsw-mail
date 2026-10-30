import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./middleware";

test("only the docs hostname rewrites its root to the public documentation", () => {
  const docs = middleware(new Request("https://mail-docs.guidedstepswellness.com/"));
  assert.equal(docs.headers.get("x-middleware-rewrite"), "https://mail-docs.guidedstepswellness.com/docs/index.html");
  const mail = middleware(new Request("https://mail.guidedstepswellness.com/"));
  assert.equal(mail.headers.get("x-middleware-rewrite"), null);
  assert.equal(mail.headers.get("x-middleware-next"), "1");
});
