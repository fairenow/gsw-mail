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
    "MAIL_ENGINE",
    "STALWART_ADMIN_TOKEN",
    "STALWART_JMAP_URL",
    "STALWART_MAIL_USERNAME",
    "STALWART_MAIL_PASSWORD",
    "DELIVERY_WEBHOOK_SECRET",
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
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
  MAIL_ENGINE: "stalwart",
  STALWART_ADMIN_TOKEN: "prod-stalwart-key-2026",
  STALWART_JMAP_URL: "https://mx1.guidedstepswellness.com",
  STALWART_MAIL_USERNAME: "test@team.guidedstepswellness.com",
  STALWART_MAIL_PASSWORD: "prod-mailbox-pass-2026",
  DELIVERY_WEBHOOK_SECRET: "whsec_3f4a9c1b8e7d2f6a",
  OIDC_ISSUER: "https://identity.guidedstepswellness.com",
  OIDC_CLIENT_ID: "gsw-mail-web",
  OUTBOUND_RELAY: "resend",
  RESEND_API_KEY: "re_prod_9f2k8a1cb",
};

test("production refuses to start without DATABASE_URL", () => {
  const { code, stderr } = runProductionConfig({});
  assert.notEqual(code, 0);
  assert.match(stderr, /DATABASE_URL must be set explicitly in production/);
});

test("production refuses to start without MAIL_ENGINE", () => {
  const { code, stderr } = runProductionConfig({ ...prodOkVars, MAIL_ENGINE: "" });
  assert.notEqual(code, 0);
  assert.match(stderr, /MAIL_ENGINE must be set explicitly in production|MAIL_ENGINE must be stalwart in production/);
});

test("a fully-specified valid configuration starts", () => {
  const valid = runProductionConfig(prodOkVars);
  assert.equal(valid.code, 0);
});

test("production refuses a placeholder admin token", () => {
  const placeholder = runProductionConfig({ ...prodOkVars, STALWART_ADMIN_TOKEN: "change-me-stalwart-admin" });
  assert.notEqual(placeholder.code, 0);
  assert.match(placeholder.stderr, /looks like a placeholder/);
});

test("production requires explicit mailbox credentials", () => {
  const noUser = runProductionConfig({ ...prodOkVars, STALWART_MAIL_USERNAME: "" });
  assert.notEqual(noUser.code, 0);
  assert.match(noUser.stderr, /STALWART_MAIL_USERNAME must be set explicitly/);
  const noPass = runProductionConfig({ ...prodOkVars, STALWART_MAIL_PASSWORD: "" });
  assert.notEqual(noPass.code, 0);
  assert.match(noPass.stderr, /STALWART_MAIL_PASSWORD must be set explicitly/);
  const placeholder = runProductionConfig({ ...prodOkVars, STALWART_MAIL_PASSWORD: "change-me" });
  assert.notEqual(placeholder.code, 0);
  assert.match(placeholder.stderr, /STALWART_MAIL_PASSWORD looks like a placeholder/);
});

test("production refuses the null relay", () => {
  const { code, stderr } = runProductionConfig({ ...prodOkVars, OUTBOUND_RELAY: "null" });
  assert.notEqual(code, 0);
  assert.match(stderr, /OUTBOUND_RELAY=null is not allowed in production/);
});

test("production refuses a placeholder delivery webhook secret", () => {
  const { code, stderr } = runProductionConfig({ ...prodOkVars, DELIVERY_WEBHOOK_SECRET: "change-me" });
  assert.notEqual(code, 0);
  assert.match(stderr, /DELIVERY_WEBHOOK_SECRET looks like a placeholder/);
});