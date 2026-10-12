import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts, userSettings } from "../db/schema.js";
import { sendAuthEmailWithResult } from "../auth/better.js";

const SUBJECT = "Welcome to GSW Mail — your workspace is ready";

const welcomeMessage = (displayName: string | null) => {
  const firstName = displayName?.trim().split(/\s+/)[0] || "there";
  const sections = [
    ["Mail", "Send, receive, organize, search, and manage your email across devices."],
    ["GSW Chat", "Ask GSW to help with your inbox, draft messages, find information, and take approved actions."],
    ["Calendar", "Manage events, invitations, reminders, and your availability."],
    ["Contacts", "Keep important people and their details together."],
    ["Files", "Upload, organize, preview, and share the files you work with."],
    ["Scheduled Work", "Set up repeating summaries and other work that GSW can help you manage."],
    ["Settings", "Manage your accounts, signatures, preferences, and privacy."],
  ] as const;
  const text = [
    `Hi ${firstName},`,
    "",
    "Welcome to GSW Mail! Your first inbox is ready. GSW brings your messages, productivity tools, and AI assistance together in one place.",
    "",
    "Here's what you can explore:",
    ...sections.flatMap(([name, description]) => [`${name}: ${description}`, ""]),
    "Start by opening your Inbox, or use the Ask GSW prompt at the bottom of the app. For actions such as sending an email, GSW will request approval when needed.",
    "",
    "We're glad you're here.",
    "The GSW Mail Team",
  ].join("\n");
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const html = `<div style="background:#faf8f2;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#292722">
    <div style="max-width:620px;margin:auto;background:white;border:1px solid #ebe5d9;border-radius:16px;padding:30px">
      <p style="font-size:13px;font-weight:700;color:#ad750d;letter-spacing:1px">GUIDED STEPS WELLNESS</p>
      <h1 style="font-size:28px;line-height:1.2">Welcome to GSW Mail!</h1>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your first inbox is ready. GSW brings your messages, productivity tools, and AI assistance together in one place.</p>
      <h2 style="font-size:19px">Explore your workspace</h2>
      ${sections.map(([name, description]) => `<div style="padding:12px 0;border-bottom:1px solid #eee"><strong>${name}</strong><div style="margin-top:5px;line-height:1.5;color:#605c54">${description}</div></div>`).join("")}
      <p style="line-height:1.6">Start in your Inbox, or use the <strong>Ask GSW</strong> composer to get help. Actions requiring approval will ask you first.</p>
      <p>We're glad you're here.<br/><strong>The GSW Mail Team</strong></p>
    </div></div>`;
  return { text, html };
};

/** Triggered only by the first authenticated inbox load. One send per user,
 * claimed atomically in user_settings; failures are released for retry. */
export async function sendWelcomeOnFirstMailboxLogin(userId: string): Promise<void> {
  const [first] = await db.select({
    address: emailAccounts.address,
    displayName: emailAccounts.displayName,
    createdAt: emailAccounts.createdAt,
    authSetupStatus: emailAccounts.authSetupStatus,
    status: emailAccounts.status,
  }).from(emailAccounts).where(eq(emailAccounts.userId, userId))
    .orderBy(emailAccounts.createdAt).limit(1);
  if (!first || first.status !== "active" || first.authSetupStatus !== "ready") return;
  // Prevent retroactive mail campaigns to long-standing accounts.
  if (Date.now() - first.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000) return;

  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  const [claimed] = await db.update(userSettings).set({
    general: sql`jsonb_set(${userSettings.general}, '{welcomeMailState}', '"sending"'::jsonb, true)`,
  }).where(and(eq(userSettings.userId, userId),
    sql`coalesce(${userSettings.general}->>'welcomeMailState', '') not in ('sending', 'sent')`))
    .returning({ userId: userSettings.userId });
  if (!claimed) return;

  try {
    await sendAuthEmailWithResult(first.address, SUBJECT, welcomeMessage(first.displayName));
    await db.update(userSettings).set({
      general: sql`jsonb_set(${userSettings.general}, '{welcomeMailState}', '"sent"'::jsonb, true)`,
    }).where(eq(userSettings.userId, userId));
  } catch (error) {
    // Allow retry on the next authenticated inbox load if the transport failed.
    await db.update(userSettings).set({
      general: sql`jsonb_set(${userSettings.general}, '{welcomeMailState}', '"failed"'::jsonb, true)`,
    }).where(and(eq(userSettings.userId, userId), sql`${userSettings.general}->>'welcomeMailState' = 'sending'`));
    throw error;
  }
}
