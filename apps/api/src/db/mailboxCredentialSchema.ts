import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers, emailAccounts, oauthClient } from "./schema.js";

export const mailboxCredentialVault = pgTable("mailbox_credential_vault", {
  accountId: uuid("account_id").primaryKey().references(() => emailAccounts.id, { onDelete: "cascade" }),
  authUserId: text("auth_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
