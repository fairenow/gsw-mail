const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`missing environment variable: ${key}`);
  return value;
};

const nodeEnv = (process.env.NODE_ENV ?? "development") as "development" | "test" | "production";
const isProduction = nodeEnv === "production";

const explicit = (key: string): string | undefined => process.env[key];

const stalwartIssuer = (process.env.OIDC_ISSUER ?? "https://localhost:443").replace(
  /\/+$/,
  "",
);

const config = {
  env: nodeEnv,
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://gsw_mail:gsw_mail@localhost:5432/gsw_mail"),
  mailEngine: env("MAIL_ENGINE", "demo"),
  stalwart: {
    jmapUrl: env("STALWART_JMAP_URL", "https://localhost:443"),
    adminToken: env("STALWART_ADMIN_TOKEN", "change-me-stalwart-admin"),
    mailUsername: process.env.STALWART_MAIL_USERNAME,
    mailPassword: process.env.STALWART_MAIL_PASSWORD,
    sessionTtlSeconds: Number(env("STALWART_SESSION_TTL_SECONDS", "60")),
  },
  outbound: {
    relay: env("OUTBOUND_RELAY", "null"),
    resendApiKey: process.env.RESEND_API_KEY,
  },
  auth: {
    identityProvider: env("IDENTITY_PROVIDER", "stalwart"),
    clientId: env("OIDC_CLIENT_ID", "gsw-mail-web"),
    issuer: stalwartIssuer,
    introspectUrl: process.env.STALWART_INTROSPECT_URL ?? `${stalwartIssuer}/auth/introspect`,
    introspectionClientId: env("OIDC_INTROSPECTION_CLIENT_ID", "gsw-mail-api"),
    introspectionClientSecret: process.env.OIDC_INTROSPECTION_CLIENT_SECRET,
  },
  send: {
    delaySeconds: Number(env("SEND_DELAY_SECONDS", "5")),
    maxRecipients: Number(env("MAX_RECIPIENTS", "50")),
    perMinute: Number(env("SEND_PER_MINUTE", "30")),
    perHour: Number(env("SEND_PER_HOUR", "400")),
  },
  deliveryWebhookSecret: process.env.DELIVERY_WEBHOOK_SECRET,
  dev: {
    userId: process.env.DEV_USER_ID ?? "ramon-dev",
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
  assertExplicit("MAIL_ENGINE", explicit("MAIL_ENGINE"));
  if (config.mailEngine !== "stalwart") {
    throw new Error("[config] MAIL_ENGINE must be stalwart in production");
  }
  assertExplicit("STALWART_ADMIN_TOKEN", explicit("STALWART_ADMIN_TOKEN"));
  assertExplicit("STALWART_JMAP_URL", explicit("STALWART_JMAP_URL"));
  assertNotPlaceholder("STALWART_ADMIN_TOKEN", config.stalwart.adminToken);
  assertNotPlaceholder("STALWART_JMAP_URL", config.stalwart.jmapUrl);
  assertExplicit("STALWART_MAIL_USERNAME", explicit("STALWART_MAIL_USERNAME"));
  assertExplicit("STALWART_MAIL_PASSWORD", explicit("STALWART_MAIL_PASSWORD"));
  assertNotPlaceholder("STALWART_MAIL_PASSWORD", config.stalwart.mailPassword!);
  assertExplicit("DELIVERY_WEBHOOK_SECRET", explicit("DELIVERY_WEBHOOK_SECRET"));
  assertNotPlaceholder("DELIVERY_WEBHOOK_SECRET", config.deliveryWebhookSecret!);
  assertExplicit("OIDC_ISSUER", explicit("OIDC_ISSUER"));
  for (const endpoint of [config.auth.issuer, config.auth.introspectUrl]) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("[config] OIDC endpoints must use HTTPS without credentials or fragments");
  }
  if (new URL(config.auth.introspectUrl).origin !== new URL(config.auth.issuer).origin) throw new Error("[config] introspection must use the OIDC issuer origin");
  assertExplicit("OIDC_CLIENT_ID", explicit("OIDC_CLIENT_ID"));
  assertNotPlaceholder("OIDC_CLIENT_ID", config.auth.clientId);
  assertExplicit("OIDC_INTROSPECTION_CLIENT_ID", explicit("OIDC_INTROSPECTION_CLIENT_ID"));
  assertNotPlaceholder("OIDC_INTROSPECTION_CLIENT_ID", config.auth.introspectionClientId);
  assertExplicit("OIDC_INTROSPECTION_CLIENT_SECRET", explicit("OIDC_INTROSPECTION_CLIENT_SECRET"));
  assertNotPlaceholder("OIDC_INTROSPECTION_CLIENT_SECRET", config.auth.introspectionClientSecret!);
  assertNotPlaceholder("DATABASE_URL", config.databaseUrl);
  if (config.send.delaySeconds < 0 || config.send.maxRecipients < 1) {
    throw new Error("[config] invalid send settings: SEND_DELAY_SECONDS must be >= 0 and MAX_RECIPIENTS >= 1");
  }
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