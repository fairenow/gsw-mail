import { strict as assert } from "node:assert";
import { test } from "node:test";
import { badRequest, conflict, forbidden, HttpError, notFound, tooManyRequests, unauthorized } from "./errors.js";

const cases: Array<[string, () => HttpError, number]> = [
  ["badRequest", () => badRequest("nope"), 400],
  ["unauthorized", () => unauthorized(), 401],
  ["forbidden", () => forbidden(), 403],
  ["notFound", () => notFound(), 404],
  ["conflict", () => conflict(), 409],
  ["tooManyRequests", () => tooManyRequests(), 429],
];

for (const [name, factory, status] of cases) {
  test(`${name} is an HttpError with status ${status}`, () => {
    const err = factory();
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, status);
    assert.equal(err.name, "HttpError");
    assert.equal(typeof err.message, "string");
  });
}

test("message is preserved on the error", () => {
  assert.equal(badRequest("no recipients").message, "no recipients");
});