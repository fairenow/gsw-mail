import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { config } from "../config.js";
import { DemoEngine } from "./demo.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let demoEngine: MailEngine | undefined;
let serviceEngine: MailEngine | undefined;

const resolveAccount = async (id: string): Promise<string> => {
  const [account] = await db.select({ address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!account) throw new Error("mail account not found");
  return account.address;
};

export function getEngine(accessToken?: string): MailEngine {
  if (config.mailEngine === "demo") {
    demoEngine ??= new DemoEngine();
    return demoEngine;
  }

  if (!accessToken) throw new Error("authenticated JMAP access token required");
  return new StalwartEngine({
    resolveAccount,
    jmapUrl: config.stalwart.jmapUrl,
    accessToken,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
}

export function getServiceEngine(): MailEngine {
  if (config.mailEngine === "demo") {
    return getEngine();
  }
  serviceEngine ??= new StalwartEngine({
    resolveAccount,
    jmapUrl: config.stalwart.jmapUrl,
    ...(config.stalwart.mailUsername ? { serviceUsername: config.stalwart.mailUsername } : {}),
    ...(config.stalwart.mailPassword ? { servicePassword: config.stalwart.mailPassword } : {}),
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
  return serviceEngine;
}
