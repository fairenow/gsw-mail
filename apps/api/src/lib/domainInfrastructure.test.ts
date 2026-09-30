import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_DMARC_POLICY, normalizeManagedDnsRecords, parseStalwartZoneFile, stripZoneComment } from "./domainInfrastructure.js";

test("preserves semicolons inside quoted TXT values", () => {
  const records = parseStalwartZoneFile([
    "$ORIGIN fairenow.com.",
    'selector._domainkey IN TXT "v=DKIM1; k=rsa; p=ABC"',
    '_dmarc IN TXT "v=DMARC1; p=none; rua=mailto:dmarc@fairenow.com"',
  ].join("\n"), "fairenow.com");

  assert.equal(records.find((record) => record.purpose === "dkim")?.value, "v=DKIM1; k=rsa; p=ABC");
  assert.equal(records.find((record) => record.purpose === "dmarc")?.value, "v=DMARC1; p=none; rua=mailto:dmarc@fairenow.com");
});

test("strips only zone comments outside quoted text", () => {
  assert.equal(stripZoneComment('fairenow.com. IN TXT "v=spf1 ip4:2.28.120.166 -all" ; generated'), 'fairenow.com. IN TXT "v=spf1 ip4:2.28.120.166 -all"');
});

test("concatenates split TXT chunks without losing DKIM content", () => {
  const [record] = parseStalwartZoneFile(
    'selector._domainkey.fairenow.com. IN TXT "v=DKIM1; k=rsa; p=AAA" "BBB"',
    "fairenow.com",
  );

  assert.equal(record?.value, "v=DKIM1; k=rsa; p=AAABBB");
});

test("parses multiline parenthesized DKIM records as one TXT value", () => {
  const records = parseStalwartZoneFile([
    "$ORIGIN example.com.",
    "v1-rsa._domainkey IN TXT (",
    '  "v=DKIM1; k=rsa; h=sha256; "',
    '  "p=AAA"',
    '  "BBB"',
    ")",
  ].join("\n"), "example.com");

  const dkim = records.find((record) => record.name === "v1-rsa._domainkey.example.com");
  assert.equal(dkim?.value, "v=DKIM1; k=rsa; h=sha256; p=AAABBB");
  assert.equal(dkim?.purpose, "dkim");
});

test("replaces Stalwart DMARC skeleton with the GSW onboarding policy", () => {
  const records = normalizeManagedDnsRecords([
    { source: "stalwart", type: "TXT", name: "_dmarc.example.com", value: "v=DMARC1", purpose: "dmarc", required: true },
    { source: "stalwart", type: "MX", name: "example.com", value: "mx1.guidedstepswellness.com", priority: 10, purpose: "mx", required: true },
  ], "example.com", { includeResend: false });

  const dmarc = records.filter((record) => record.purpose === "dmarc");
  assert.equal(dmarc.length, 1);
  assert.deepEqual(dmarc[0], {
    source: "gsw",
    type: "TXT",
    name: "_dmarc.example.com",
    value: DEFAULT_DMARC_POLICY,
    purpose: "dmarc",
    required: true,
  });
});

test("drops malformed DKIM placeholders instead of treating them as verifiable records", () => {
  const records = normalizeManagedDnsRecords([
    { source: "stalwart", type: "TXT", name: "v1-rsa._domainkey.example.com", value: "(", purpose: "dkim", required: true },
    { source: "stalwart", type: "TXT", name: "v1-ed25519._domainkey.example.com", value: "v=DKIM1; k=ed25519; p=ABC", purpose: "dkim", required: true },
  ], "example.com", { includeResend: false });

  assert.equal(records.some((record) => record.value === "("), false);
  assert.equal(records.some((record) => record.value === "v=DKIM1; k=ed25519; p=ABC"), true);
});

test("removes stale Resend and SES DNS records when mailbox relay is Stalwart", () => {
  const records = normalizeManagedDnsRecords([
    { source: "stalwart", type: "MX", name: "example.com", value: "mx1.guidedstepswellness.com", priority: 10, purpose: "mx", required: true },
    { source: "stalwart", type: "TXT", name: "example.com", value: "v=spf1 ip4:2.28.120.166 -all", purpose: "spf", required: true },
    { source: "resend", type: "MX", name: "send.example.com", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, purpose: "spf", required: true },
    { source: "resend", type: "TXT", name: "send.example.com", value: "v=spf1 include:amazonses.com ~all", purpose: "spf", required: true },
  ], "example.com", { includeResend: false });

  assert.equal(records.some((record) => record.source === "resend"), false);
  assert.equal(records.some((record) => record.value.includes("amazonses.com")), false);
  assert.equal(records.some((record) => record.value === "v=spf1 ip4:2.28.120.166 -all"), true);
});
