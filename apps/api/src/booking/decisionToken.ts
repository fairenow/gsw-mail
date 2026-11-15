import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
const claimsSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    userId: z.string().min(1),
    exp: z.number().int().positive(),
  })
  .strict();
export type BookingDecisionClaims = z.infer<typeof claimsSchema>;
const sign = (payload: string) =>
  createHmac("sha256", config.auth.secret)
    .update(`gsw-booking-decision-v1:${payload}`)
    .digest("base64url");
export function createBookingDecisionToken(claims: BookingDecisionClaims) {
  const payload = Buffer.from(
    JSON.stringify(claimsSchema.parse(claims)),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function verifyBookingDecisionToken(
  token: string,
  now = Date.now(),
): BookingDecisionClaims | null {
  if (token.length > 2000) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(sign(parts[0])),
    supplied = Buffer.from(parts[1]);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return null;
  try {
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
    return claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}
