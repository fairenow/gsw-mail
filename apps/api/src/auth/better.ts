import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authAccounts, authSessions, authUsers, authVerifications } from "../db/schema.js";

const resend = config.outbound.resendApiKey ? new Resend(config.outbound.resendApiKey) : null;

async function sendAuthEmail(to: string, subject: string, text: string): Promise<void> {
  if (!resend) {
    if (config.env === "production") throw new Error("auth email delivery is not configured");
    console.info(`[auth email] ${to}: ${text}`);
    return;
  }
  await resend.emails.send({ from: config.authEmail.from, to, subject, text });
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
    sendResetPassword: async ({ user, url }) => sendAuthEmail(user.email, "Reset your GSW password", `Reset your password: ${url}`),
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => sendAuthEmail(user.email, "Verify your GSW Account", `Verify your email address: ${url}`),
  },
  plugins: [emailOTP({
    sendVerificationOTP: async ({ email, otp, type }) => sendAuthEmail(email, `Your GSW ${type === "sign-in" ? "sign-in" : "verification"} code`, `Your one-time code is ${otp}. It expires in five minutes.`),
    sendVerificationOnSignUp: false,
    overrideDefaultEmailVerification: true,
    storeOTP: "hashed",
  })],
});
