import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authAccounts, authSessions, authUsers, authVerifications } from "../db/schema.js";
import { renderGswAuthEmail } from "./email.js";

const resend = config.outbound.resendApiKey ? new Resend(config.outbound.resendApiKey) : null;

export async function sendAuthEmail(to: string, subject: string, content: { text: string; html: string }): Promise<void> {
  if (!resend) {
    if (config.env === "production") throw new Error("auth email delivery is not configured");
    console.info(`[auth email] ${to}: ${content.text}`);
    return;
  }
  await resend.emails.send({ from: config.authEmail.from, to, subject, text: content.text, html: content.html });
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications },
  }),
  baseURL: config.auth.baseUrl,
  basePath: "/api/auth",
  secret: config.auth.secret,
  trustedOrigins: [config.auth.baseUrl, config.auth.trustedOrigin],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => sendAuthEmail(user.email, "Reset your GSW password", renderGswAuthEmail({ title: "Reset your password", message: "Use the button below to reset your GSW Account password.", ctaUrl: url, ctaLabel: "Reset password" })),
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => sendAuthEmail(user.email, "Verify your GSW Account", renderGswAuthEmail({ title: "Verify your email", message: "Confirm your email address to continue to GSW.", ctaUrl: url, ctaLabel: "Verify email" })),
  },
  plugins: [emailOTP({
    sendVerificationOTP: async ({ email, otp, type }) => sendAuthEmail(email, `Your GSW ${type === "sign-in" ? "sign-in" : type === "forget-password" ? "password reset" : "verification"} code`, renderGswAuthEmail({ title: type === "sign-in" ? "Your sign-in code" : type === "forget-password" ? "Reset your password" : "Your verification code", message: type === "forget-password" ? "Use this one-time code to reset your GSW password." : "Use this one-time code to continue to GSW Mail.", code: otp, expiryMinutes: 10 })),
    sendVerificationOnSignUp: false,
    overrideDefaultEmailVerification: true,
    otpLength: 6,
    expiresIn: 600,
    allowedAttempts: 5,
    resendStrategy: "reuse",
    storeOTP: "hashed",
  })],
});
