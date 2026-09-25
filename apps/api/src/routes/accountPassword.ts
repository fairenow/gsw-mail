import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth/better.js";
import { requireUser } from "../auth/middleware.js";

const passwordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

function requestHeaders(input: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

export default async function accountPasswordRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  // Better Auth's setPassword action is intentionally server-only. The web client
  // cannot call /api/auth/set-password directly. This authenticated control-plane
  // endpoint forwards the caller's verified session to the server API so a user
  // who enrolled with email OTP can create their first credential account.
  app.post("/api/account/set-password", async (req) => {
    const { newPassword } = passwordSchema.parse(req.body ?? {});
    await auth.api.setPassword({
      body: { newPassword },
      headers: requestHeaders(req.headers),
    });
    return { success: true };
  });
}
