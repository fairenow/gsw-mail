import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const context = "gsw-calendar-rsvp-v1";

const signature = (payload: string): string =>
  createHmac("sha256", config.auth.secret).update(`${context}:${payload}`).digest("base64url");

export const createCalendarRsvpToken = (id: string, expiresAt: Date): string => {
  const payload = Buffer.from(JSON.stringify({ id, exp: expiresAt.getTime() }), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
};

export const verifyCalendarRsvpToken = (token: string): { id: string; expiresAt: Date } | null => {
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: unknown; exp?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    const expiresAt = new Date(parsed.exp);
    if (expiresAt.getTime() <= Date.now()) return null;
    return { id: parsed.id, expiresAt };
  } catch {
    return null;
  }
};

export const calendarRsvpUrl = (token: string, response?: "accepted" | "declined" | "tentative"): string => {
  const url = new URL("https://mail.guidedstepswellness.com/calendar/rsvp");
  url.searchParams.set("token", token);
  if (response) url.searchParams.set("response", response);
  return url.toString();
};
