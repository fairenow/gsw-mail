import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configEntry = join(root, "src", "config.ts");

const runProductionConfig = (overrides: Record<string, string>): { code: number; stderr: string } => {
  const env: Record<string, string | undefined> = { ...(process.env as Record<string, string>) };
  for (const key of [
    "DATABASE_URL",
    "STALWART_ADMIN_TOKEN",
    "STALWART_JMAP_URL",
    "DELIVERY_WEBHOOK_SECRET",
    "JWT_ISSUER",
    "JWKS_URL",
    "RESEND_API_KEY",
  ]) {
    delete env[key];
  }
  env.NODE_ENV = "production";
  Object.assign(env, overrides);
  try {
    execFileSync(process.execPath, ["--import", "tsx", configEntry], { encoding: "utf8", env, timeout: 30_000 });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
};

const prodOkVars = {
  DATABASE_URL: "postgres://gsw:pw9f2k8a1cb@prod-db.internal:5432/gsw_mail",
  STALWART_ADMIN_TOKEN: "prod-stalwart-key-2026",
  STALWART_JMAP_URL: "https://mx1.guidedstepswellness.com",
  DELIVERY_WEBHOOK_SECRET: "whsec_3f4a9c1b8e7d2f6a",
  JWT_ISSUER: "https://identity.guidedstepswellness.com",
  JWKS_URL: "https://identity.guidedstepswellness.com/.well-known/jwks.json",
  OUTBOUND_RELAY: "resend",
  RESEND_API_KEY: "re_prod_9f2k8a1cb",
};

test("production refuses to start without DATABASE_URL", () => {
  const { code, stderr } = runProductionConfig({});
  assert.notEqual(code, 0);
  assert.match(stderr, /DATABASE_URL must be set explicitly in production/);
});

test("a fully-specified valid configuration starts, but a placeholder admin token fails", () => {
  const valid = runProductionConfig(prodOkVars);
  assert.equal(valid.code, 0);
  const placeholder = runProductionConfig({ ...prodOkVars, STALWART_ADMIN_TOKEN: "change-me-stalwart-admin" });
  assert.notEqual(placeholder.code, 0);
  assert.match(placeholder.stderr, /looks like a placeholder/);
});

test("production refuses the null relay", () => {
  const { code, stderr } = runProductionConfig({ ...prodOkVars, OUTBOUND_RELAY: "null" });
  assert.notEqual(code, 0);
  assert.match(stderr, /OUTBOUND_RELAY=null is not allowed in production/);
});