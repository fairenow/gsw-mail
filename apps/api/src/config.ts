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
    sessionTtlSeconds: Number(env("STALWART_SESSION_TTL_SECONDS", "60")),
  },
  outbound: {
    relay: env("OUTBOUND_RELAY", "null"),
    resendApiKey: process.env.RESEND_API_KEY,
  },
  auth: {
    identityProvider: env("IDENTITY_PROVIDER", "better-auth"),
    baseUrl: env("BETTER_AUTH_URL", "http://localhost:4000"),
    trustedOrigin: env("BETTER_AUTH_TRUSTED_ORIGIN", "http://localhost:3000"),
    secret: env("BETTER_AUTH_SECRET", "development-only-better-auth-secret-change-me"),
    oauthClientId: process.env.BETTER_AUTH_STALWART_CLIENT_ID,
    oauthClientSecret: process.env.BETTER_AUTH_STALWART_CLIENT_SECRET,
    oauthRedirectUri: env("BETTER_AUTH_STALWART_REDIRECT_URI", "http://localhost:4000/internal/oauth/stalwart/callback"),
    mobileClientId: env("GSW_MOBILE_OAUTH_CLIENT_ID", "gsw-mail-mobile"),
    mobileRedirectUri: env("GSW_MOBILE_OAUTH_REDIRECT_URI", "gswmail://oauth"),
    stalwartAudience: "stalwart",
    tokenTtlSeconds: 900,
    issuer: `${env("BETTER_AUTH_URL", "http://localhost:4000")}/api/auth`,
  },
  send: {
    delaySeconds: Number(env("SEND_DELAY_SECONDS", "5")),
    maxRecipients: Number(env("MAX_RECIPIENTS", "50")),
    perMinute: Number(env("SEND_PER_MINUTE", "30")),
    perHour: Number(env("SEND_PER_HOUR", "400")),
  },
  mail: {
    defaultTemplateKey: env("DEFAULT_MAIL_TEMPLATE_KEY", "none"),
  },
  provisioning: {
    organizationName: env("PROVISIONING_ORGANIZATION_NAME", "Guided Steps Wellness"),
    organizationSlug: env("PROVISIONING_ORGANIZATION_SLUG", "guided-steps-wellness"),
    defaultQuotaBytes: Number(env("PROVISIONING_DEFAULT_QUOTA_BYTES", "5000000000")),
  },
  deliveryWebhookSecret: process.env.DELIVERY_WEBHOOK_SECRET,
  authEmail: {
    from: env("AUTH_EMAIL_FROM", "GSW <no-reply@localhost>"),
  },
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
  assertExplicit("BETTER_AUTH_STALWART_CLIENT_ID", explicit("BETTER_AUTH_STALWART_CLIENT_ID"));
  assertExplicit("BETTER_AUTH_STALWART_CLIENT_SECRET", explicit("BETTER_AUTH_STALWART_CLIENT_SECRET"));
  assertNotPlaceholder("BETTER_AUTH_STALWART_CLIENT_SECRET", config.auth.oauthClientSecret!);
  assertExplicit("DELIVERY_WEBHOOK_SECRET", explicit("DELIVERY_WEBHOOK_SECRET"));
  assertNotPlaceholder("DELIVERY_WEBHOOK_SECRET", config.deliveryWebhookSecret!);
  assertExplicit("BETTER_AUTH_SECRET", explicit("BETTER_AUTH_SECRET"));
  assertNotPlaceholder("BETTER_AUTH_SECRET", config.auth.secret);
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
