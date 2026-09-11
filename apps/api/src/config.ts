const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`missing environment variable: ${key}`);
  return value;
};

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://gsw_mail:gsw_mail@localhost:5432/gsw_mail"),
  mailEngine: env("MAIL_ENGINE", "demo"),
  apiToken: env("TO_API_TOKEN", "dev-token-change-me"),
  stalwart: {
    jmapUrl: env("STALWART_JMAP_URL", "https://localhost:443"),
    adminToken: env("STALWART_ADMIN_TOKEN", "change-me-stalwart-admin"),
  },
  outbound: {
    relay: env("OUTBOUND_RELAY", "null"),
    resendApiKey: process.env.RESEND_API_KEY,
  },
  dev: {
    userId: process.env.DEV_USER_ID ?? "dev-user",
    adminUserIds: new Set((process.env.ADMIN_USER_IDS ?? "dev-user").split(",")),
  },
} as const;