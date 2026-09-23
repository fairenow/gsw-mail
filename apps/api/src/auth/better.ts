import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { Resend } from "resend";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authAccounts, authSessions, authUsers, authVerifications, domains, emailAccounts, jwks, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, organizationMemberships, users } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { renderGswAuthEmail } from "./email.js";

const resend = config.outbound.resendApiKey ? new Resend(config.outbound.resendApiKey) : null;

export async function sendAuthEmailWithResult(to: string, subject: string, content: { text: string; html: string }): Promise<string | undefined> {
  if (!resend) {
    if (config.env === "production") throw new Error("auth email delivery is not configured");
    console.info(`[auth email] ${to}: ${content.text}`);
    return undefined;
  }
  const result = await resend.emails.send({ from: config.authEmail.from, to, subject, text: content.text, html: content.html });
  if (result.error) throw new Error(result.error.message);
  return result.data?.id;
}

export async function sendAuthEmail(to: string, subject: string, content: { text: string; html: string }): Promise<void> {
  await sendAuthEmailWithResult(to, subject, content);
}

async function recoveryEmailForMailbox(email: string): Promise<string | null> {
  const [owner] = await db
    .select({ email: authUsers.email })
    .from(emailAccounts)
    .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, domains.organizationId), eq(organizationMemberships.role, "owner"), eq(organizationMemberships.status, "active")))
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .innerJoin(authUsers, eq(users.authUserId, authUsers.id))
    .where(eq(emailAccounts.address, email.toLowerCase()))
    .limit(1);
  return owner?.email ?? null;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
     schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, jwks, oauthClient, oauthRefreshToken, oauthAccessToken, oauthConsent },
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
  plugins: [
    jwt({
      jwks: { keyPairConfig: { alg: "ES256" } },
      jwt: {
        issuer: config.auth.issuer,
        audience: config.auth.stalwartAudience,
        expirationTime: "15m",
      },
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/sign-in",
      scopes: ["openid", "email", "offline_access"],
      validAudiences: [config.auth.stalwartAudience],
      accessTokenExpiresIn: config.auth.tokenTtlSeconds,
      refreshTokenReuseInterval: 30,
      customUserInfoClaims: ({ user }) => ({
        email: user.email,
        email_verified: user.emailVerified,
        name: user.name,
        preferred_username: user.email,
      }),
      customAccessTokenClaims: ({ user, resource, scopes }) => resource === config.auth.stalwartAudience && user && scopes.includes("email")
        ? { email: user.email, preferred_username: user.email, name: user.name }
        : {},
    }),
    emailOTP({
    sendVerificationOTP: async ({ email, otp, type }) => {
      const recoveryEmail = type === "forget-password" ? await recoveryEmailForMailbox(email) : null;
      const destination = recoveryEmail ?? email;
      const mailboxMessage = recoveryEmail ? `Use this one-time code to reset the password for ${email}. This code was sent to the workspace recovery email.` : "Use this one-time code to reset your GSW password.";
      return sendAuthEmail(destination, `Your GSW ${type === "sign-in" ? "sign-in" : type === "forget-password" ? "password reset" : "verification"} code`, renderGswAuthEmail({ title: type === "sign-in" ? "Your sign-in code" : type === "forget-password" ? "Reset your password" : "Your verification code", message: type === "forget-password" ? mailboxMessage : "Use this one-time code to continue to GSW Mail.", code: otp, expiryMinutes: 10 }));
    },
    sendVerificationOnSignUp: false,
    overrideDefaultEmailVerification: true,
    otpLength: 6,
    expiresIn: 600,
    allowedAttempts: 5,
    resendStrategy: "reuse",
    storeOTP: "hashed",
    }),
  ],
});
