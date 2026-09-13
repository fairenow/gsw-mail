import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderGswAuthEmail } from "./email.js";

test("renders branded sign-in OTP email", () => {
  const email = renderGswAuthEmail({ title: "Your sign-in code", message: "Use this code.", code: "213879", expiryMinutes: 10 });
  assert.match(email.html, /guided_steps_logo\.png/);
  assert.match(email.html, /Your sign-in code/);
  assert.match(email.html, /213879/);
  assert.match(email.html, /10 minutes/);
  assert.match(email.text, /Code: 213879/);
});

test("escapes auth email content", () => {
  const email = renderGswAuthEmail({ title: "<Verify>", message: "A & B", code: "123456" });
  assert.match(email.html, /&lt;Verify&gt;/);
  assert.match(email.html, /A &amp; B/);
});
