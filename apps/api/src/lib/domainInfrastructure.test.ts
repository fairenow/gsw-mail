import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseStalwartZoneFile, stripZoneComment } from "./domainInfrastructure.js";

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
