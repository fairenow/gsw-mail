const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`missing environment variable: ${key}`);
  return value;
};

const nodeEnv = (process.env.NODE_ENV ?? "development") as "development" | "test" | "production";
const isProduction = nodeEnv === "production";

const explicit = (key: string): string | undefined => process.env[key];

const config = {
  env: nodeEnv,
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://gsw_mail:gsw_mail@localhost:5432/gsw_mail"),
  mailEngine: env("MAIL_ENGINE", "demo"),
  stalwart: {
    jmapUrl: env("STALWART_JMAP_URL", "https://localhost:443"),
    adminToken: env("STALWART_ADMIN_TOKEN", "change-me-stalwart-admin"),
  },
  outbound: {
    relay: env("OUTBOUND_RELAY", "null"),
    resendApiKey: process.env.RESEND_API_KEY,
  },
  auth: {
    userToken: env("TO_API_TOKEN", "dev-token-change-me"),
    userId: env("AUTH_USER_ID", "dev-user"),
    adminToken: env("ADMIN_API_TOKEN", "change-me-admin-token"),
  },
  deliveryWebhookSecret: process.env.DELIVERY_WEBHOOK_SECRET,
  dev: {
    userId: process.env.DEV_USER_ID ?? "dev-user",
    adminUserIds: new Set((process.env.ADMIN_USER_IDS ?? "dev-user").split(",")),
  },
} as const;

function assertExplicit(key: string, value: string | undefined): asserts value is string {
  if (value === undefined || value === "") {
    throw new Error(`[config] ${key} must be set explicitly in production; refusing to start with a fallback`);
  }
}

function assertNotPlaceholder(key: string, value: string): void {
  const lowered = value.toLowerCase();
  const placeholders = ["change-me", "changeme", "dev-token", "replace-me", "your-secret", "secret"];
  if (placeholders.some((needle) => lowered.includes(needle))) {
    throw new Error(`[config] ${key} looks like a placeholder/default value; refusing to start in production`);
  }
}

if (isProduction) {
  assertExplicit("DATABASE_URL", explicit("DATABASE_URL"));
  assertExplicit("TO_API_TOKEN", explicit("TO_API_TOKEN"));
  assertExplicit("ADMIN_API_TOKEN", explicit("ADMIN_API_TOKEN"));
  assertExplicit("AUTH_USER_ID", explicit("AUTH_USER_ID"));
  assertExplicit("STALWART_ADMIN_TOKEN", explicit("STALWART_ADMIN_TOKEN"));
  assertExplicit("STALWART_JMAP_URL", explicit("STALWART_JMAP_URL"));
  assertExplicit("DELIVERY_WEBHOOK_SECRET", explicit("DELIVERY_WEBHOOK_SECRET"));
  assertNotPlaceholder("DATABASE_URL", config.databaseUrl);
  assertNotPlaceholder("TO_API_TOKEN", config.auth.userToken);
  assertNotPlaceholder("ADMIN_API_TOKEN", config.auth.adminToken);
  assertNotPlaceholder("STALWART_ADMIN_TOKEN", config.stalwart.adminToken);
  if (config.outbound.relay === "null") {
    throw new Error("[config] OUTBOUND_RELAY=null is not allowed in production; configure a real relay");
  }
  if (config.outbound.relay === "resend") {
    assertExplicit("RESEND_API_KEY", explicit("RESEND_API_KEY"));
    assertNotPlaceholder("RESEND_API_KEY", config.outbound.resendApiKey!);
  }
}

export { config };
export type AppConfig = typeof config;