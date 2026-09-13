import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { authUsers, users } from "./schema.js";

const currentEmail = process.env.CURRENT_CONTROL_EMAIL?.trim().toLowerCase();
const nextEmail = process.env.NEW_CONTROL_EMAIL?.trim().toLowerCase();

if (!currentEmail || !nextEmail) throw new Error("CURRENT_CONTROL_EMAIL and NEW_CONTROL_EMAIL must be set");
if (currentEmail === nextEmail) throw new Error("new control email must differ from current email");

try {
  await db.transaction(async (tx) => {
    const current = (await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, currentEmail)).limit(1))[0];
    if (!current) throw new Error(`control identity not found for ${currentEmail}`);
    const existing = (await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, nextEmail)).limit(1))[0];
    if (existing && existing.id !== current.id) throw new Error(`${nextEmail} is already a different Better Auth identity`);
    await tx.update(authUsers).set({ email: nextEmail, emailVerified: false }).where(eq(authUsers.id, current.id));
    const linked = await tx.update(users).set({ email: nextEmail, emailVerified: false }).where(and(eq(users.authUserId, current.id), eq(users.identityProvider, "better-auth"))).returning({ id: users.id });
    if (linked.length === 0) throw new Error("control identity has no linked product user");
    console.log(JSON.stringify({ authUserId: current.id, productUserId: linked[0]!.id, email: nextEmail }));
  });
} finally {
  await pool.end();
}
