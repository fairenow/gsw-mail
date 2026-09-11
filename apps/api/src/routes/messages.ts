import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { inboundMessages, mailboxRole } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";

type MailboxRole = (typeof mailboxRole.enumValues)[number];

interface Params {
  id: string;
}

interface Query {
  accountId: string;
  mailbox?: string;
  limit?: string;
  offset?: string;
  threadId?: string;
}

type ActionBody = { accountId?: string; seen?: boolean; flagged?: boolean; mailbox?: string };

const seenSchema = z.object({ accountId: z.string(), seen: z.boolean() });
const flagSchema = z.object({ accountId: z.string(), flagged: z.boolean() });
const moveSchema = z.object({ accountId: z.string(), mailbox: z.string() });

const roleFromName = (name: string): MailboxRole | null => {
  const found = mailboxRole.enumValues.find((r) => r === name.toLowerCase());
  return found ?? null;
};

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });
  const engine = getEngine();

  app.get<{ Querystring: Query }>("/mail/messages", async ({ query, user }) => {
    if (!query.accountId) throw badRequest("accountId is required");
    const accountId = query.accountId;
    await requireAccountPermission(user!.id, accountId, "read");

    const mailboxes = await engine.listMailboxes(accountId);
    const requested = (query.mailbox ?? "inbox").toLowerCase();
    const matched = mailboxes.find((m) => m.role === requested) ?? mailboxes.find((m) => m.engineName.toLowerCase() === requested);
    const mailbox = matched?.engineName ?? query.mailbox ?? "Inbox";

    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    const messages = await engine.listMessages(accountId, {
      mailbox,
      limit,
      offset,
      threadId: query.threadId,
    });
    return { messages };
  });

  app.get<{ Params: Params; Querystring: Query }>("/mail/messages/:id", async ({ params, query, user }) => {
    if (!query.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, query.accountId, "read");
    const message = await engine.getMessage(query.accountId, params.id);
    if (!message) throw notFound("message not found");
    return message;
  });

  app.post<{ Params: Params; Body: ActionBody }>("/mail/messages/:id/read", async (req) => {
    const input = seenSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    await engine.setSeen(input.accountId, [req.params.id], input.seen);
    await syncCache(input.accountId, req.params.id, { read: input.seen });
    return { messageId: req.params.id, read: input.seen };
  });

  app.post<{ Params: Params; Body: ActionBody }>("/mail/messages/:id/flag", async (req) => {
    const input = flagSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    await engine.setFlagged(input.accountId, [req.params.id], input.flagged);
    await syncCache(input.accountId, req.params.id, { flagged: input.flagged });
    return { messageId: req.params.id, flagged: input.flagged };
  });

  app.post<{ Params: Params; Body: ActionBody }>("/mail/messages/:id/move", async (req) => {
    const input = moveSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "send");
    await engine.move(input.accountId, [req.params.id], input.mailbox);
    const role = roleFromName(input.mailbox);
    if (role) await syncCache(input.accountId, req.params.id, { mailboxRole: role });
    return { messageId: req.params.id, mailbox: input.mailbox };
  });

  app.post<{ Params: Params; Body: ActionBody }>("/mail/messages/:id/archive", async ({ params, body, user }) => {
    if (!body.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, body.accountId, "send");
    await engine.move(body.accountId, [params.id], "Archive");
    await syncCache(body.accountId, params.id, { mailboxRole: "archive" });
    return { messageId: params.id, mailbox: "Archive" };
  });

  app.post<{ Params: Params; Body: ActionBody }>("/mail/messages/:id/trash", async ({ params, body, user }) => {
    if (!body.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, body.accountId, "send");
    await engine.move(body.accountId, [params.id], "Trash");
    await syncCache(body.accountId, params.id, { mailboxRole: "trash" });
    return { messageId: params.id, mailbox: "Trash" };
  });

  async function syncCache(accountId: string, engineId: string, patch: Partial<{ read: boolean; flagged: boolean; mailboxRole: MailboxRole }>) {
    try {
      const [cached] = await db
        .select({ id: inboundMessages.id })
        .from(inboundMessages)
        .where(and(eq(inboundMessages.accountId, accountId), eq(inboundMessages.engineId, engineId)))
        .limit(1);
      if (cached) {
        await db.update(inboundMessages).set(patch).where(eq(inboundMessages.id, cached.id));
      }
    } catch (err) {
      app.log.warn(err, "inbound-message index sync failed; mail action still succeeded");
    }
  }
});