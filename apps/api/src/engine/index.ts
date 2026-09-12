import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { config } from "../config.js";
import { DemoEngine } from "./demo.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let engine: MailEngine | undefined;

export function getEngine(): MailEngine {
  if (!engine) {
    engine =
      config.mailEngine === "stalwart"
        ? new StalwartEngine({
            resolveAccount: async (id) => {
              const [account] = await db.select({ address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
              if (!account) throw new Error("mail account not found");
              return account.address;
            },
            jmapUrl: config.stalwart.jmapUrl,
            adminToken: config.stalwart.adminToken,
            sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
          })
        : new DemoEngine();
  }
  return engine;
}