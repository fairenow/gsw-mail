import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getStalwartAccessToken } from "../auth/stalwartToken.js";
import { config } from "../config.js";
import { JmapClient, JmapError } from "../engine/jmap.js";
import { badRequest, notFound } from "../lib/errors.js";

const accountQuerySchema = z.object({ accountId: z.string().uuid() });
const createFolderSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).nullable().optional(),
});
const updateFolderSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
}).refine((input) => input.name !== undefined || input.parentId !== undefined, { message: "name or parentId is required" });
const folderParamsSchema = z.object({ id: z.string().min(1) });

type JmapMailbox = {
  id: string;
  name: string;
  parentId?: string | null;
  role?: string | null;
  sortOrder?: number;
  totalEmails?: number;
  unreadEmails?: number;
};

const mailboxProperties = ["id", "name", "parentId", "role", "sortOrder", "totalEmails", "unreadEmails"];

async function mailboxContext(req: any, accountId: string, permission: "read" | "send" = "read") {
  if (!req.authUserId) throw new Error("mailbox auth identity is unavailable");
  const account = await requireAccountPermission(req.user!.id, accountId, permission);
  const token = await getStalwartAccessToken({
    authUserId: req.authUserId,
    accountId: account.id,
    headers: req.headers as Record<string, string>,
  });
  const client = new JmapClient({
    baseUrl: config.stalwart.jmapUrl,
    token,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
  const session = await client.session();
  const jmapAccountId = client.resolveAccountId(session, account.address);
  return { account, client, jmapAccountId };
}

async function listMailboxes(client: JmapClient, accountId: string): Promise<JmapMailbox[]> {
  const response = await client.call([["Mailbox/get", { accountId, ids: null, properties: mailboxProperties }, "m1"]]);
  const list = response[0]?.[1]?.list;
  if (!Array.isArray(list)) return [];
  return (list as JmapMailbox[]).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

function publicMailbox(mailbox: JmapMailbox) {
  return {
    id: mailbox.id,
    name: mailbox.name,
    parentId: mailbox.parentId ?? null,
    role: mailbox.role ?? null,
    sortOrder: mailbox.sortOrder ?? 0,
    total: mailbox.totalEmails ?? 0,
    unread: mailbox.unreadEmails ?? 0,
    system: Boolean(mailbox.role),
  };
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get("/mail/folders", async (req) => {
    const { accountId } = accountQuerySchema.parse(req.query);
    const { client, jmapAccountId } = await mailboxContext(req, accountId, "read");
    const mailboxes = await listMailboxes(client, jmapAccountId);
    return { folders: mailboxes.map(publicMailbox) };
  });

  app.post("/mail/folders", async (req, reply) => {
    const input = createFolderSchema.parse(req.body);
    const { client, jmapAccountId } = await mailboxContext(req, input.accountId, "send");
    const existing = await listMailboxes(client, jmapAccountId);
    if (existing.some((mailbox) => mailbox.name.toLowerCase() === input.name.toLowerCase())) {
      throw badRequest("folder names must currently be unique within a mailbox");
    }
    if (input.parentId && !existing.some((mailbox) => mailbox.id === input.parentId)) throw notFound("parent folder not found");

    const response = await client.call([[
      "Mailbox/set",
      {
        accountId: jmapAccountId,
        create: {
          folder: {
            name: input.name,
            ...(input.parentId ? { parentId: input.parentId } : {}),
            sortOrder: 100,
          },
        },
      },
      "m1",
    ]]);
    const created = (response[0]?.[1]?.created as Record<string, JmapMailbox> | undefined)?.folder;
    if (!created?.id) {
      throw new JmapError("folder creation failed", "mailbox_not_created", "m1", response[0]?.[1]?.notCreated);
    }
    const refreshed = await listMailboxes(client, jmapAccountId);
    const folder = refreshed.find((mailbox) => mailbox.id === created.id) ?? created;
    reply.code(201);
    return { folder: publicMailbox(folder) };
  });

  app.patch("/mail/folders/:id", async (req) => {
    const { id } = folderParamsSchema.parse(req.params);
    const input = updateFolderSchema.parse(req.body);
    const { client, jmapAccountId } = await mailboxContext(req, input.accountId, "send");
    const existing = await listMailboxes(client, jmapAccountId);
    const current = existing.find((mailbox) => mailbox.id === id);
    if (!current) throw notFound("folder not found");
    if (current.role) throw badRequest("system folders cannot be renamed or nested");
    if (input.parentId === id) throw badRequest("a folder cannot be its own parent");
    if (input.parentId && !existing.some((mailbox) => mailbox.id === input.parentId)) throw notFound("parent folder not found");
    if (input.name && existing.some((mailbox) => mailbox.id !== id && mailbox.name.toLowerCase() === input.name!.toLowerCase())) {
      throw badRequest("folder names must currently be unique within a mailbox");
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.parentId !== undefined) patch.parentId = input.parentId;
    const response = await client.call([["Mailbox/set", { accountId: jmapAccountId, update: { [id]: patch } }, "m1"]]);
    const notUpdated = response[0]?.[1]?.notUpdated as Record<string, unknown> | undefined;
    if (notUpdated?.[id]) throw new JmapError("folder update failed", "mailbox_not_updated", "m1", notUpdated[id]);
    const refreshed = await listMailboxes(client, jmapAccountId);
    const folder = refreshed.find((mailbox) => mailbox.id === id);
    if (!folder) throw notFound("folder not found after update");
    return { folder: publicMailbox(folder) };
  });
};
