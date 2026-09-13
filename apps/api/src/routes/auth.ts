import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";

const exchangeSchema = z.object({
  code: z.string().trim().min(1).max(8192),
  codeVerifier: z.string().trim().min(43).max(128),
  redirectUri: z.string().url().max(2048),
});

export default async (app: FastifyInstance) => {
  app.post<{ Body: unknown }>("/auth/exchange", async (req, reply) => {
    const { code, codeVerifier, redirectUri } = exchangeSchema.parse(req.body);
    const upstream = await fetch(`${config.auth.issuer}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.auth.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) throw badRequest("token exchange failed");
    const body = (await upstream.json()) as Record<string, unknown>;
    if (
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    ) {
      throw badRequest("token exchange returned an invalid response");
    }
    reply.code(200);
    return {
      access_token: body.access_token,
      token_type: body.token_type,
      expires_in: body.expires_in,
    };
  });
};